# rbxts-transform-boost

> **Successor to [`rbxts-transformer-luau-annotate`](https://github.com/Loner1536/rbxts-transformer-luau-annotate).** That package was accidentally removed from npm. Migrate to this one.
>
> **What carried over:** Luau type annotation injection on function parameters for native codegen (primitives, Roblox value types, arrays).
>
> **What's new:** `--!optimize 2` on every file, `game:GetService()` hoisting to module-level locals, repeated property chain hoisting, loop bounds hoisting — all without needing `//!native` in every file.
>
> **What's different:** The old package also annotated return types, local variable declarations, class methods, and user-defined interfaces/type aliases. Those are not yet in this package — they're planned but the implementation is non-trivial. The old package also had reliability issues that this rewrite addresses.

A TypeScript transformer for Roblox that automatically applies Luau performance directives at compile time — no runtime cost, no code changes required.

## Installation

```bash
npm install --save-dev rbxts-transform-boost
```

`tsconfig.json`:
```json
{
    "compilerOptions": {
        "plugins": [
            {
                "transform": "rbxts-transform-boost",
                "optimize": true,
                "hoist": true
            }
        ]
    }
}
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `optimize` | `boolean` | `true` | Prepend `--!optimize 2` to every file that doesn't already have it |
| `hoist` | `boolean` | `true` | Hoist `GetService` calls and repeated property reads to locals |

`--!native` is never auto-inserted. Add `//!native` at the top of your TypeScript file for hot paths you've profiled — the compiler preserves it.

```typescript
//!native
export function integrate(pos: Vector3, vel: Vector3, acc: Vector3, dt: number) {
    ...
}
```

---

## What it does

### `--!optimize 2` — always on top

Every file gets `--!optimize 2` prepended if it doesn't already have it. Roblox already runs all scripts at optimization level 2, but the directive makes Studio behaviour match production and signals intent.

```typescript
// TypeScript source
export function encodeFixed(buf: buffer, offset: number, value: number, scale: number): number {
    const fixed = math.floor(value * scale);
    const clamped = math.clamp(fixed, -32768, 32767);
    buffer.writei16(buf, offset, clamped);
    return offset + 2;
}
```

```lua
-- Without transformer
local function encodeFixed(buf, offset, value, scale)
    local fixed = math.floor(value * scale)
    local clamped = math.clamp(fixed, -32768, 32767)
    buffer.writei16(buf, offset, clamped)
    return offset + 2
end
```

```lua
-- With transformer
--!optimize 2
local function encodeFixed(buf: buffer, offset: number, value: number, scale: number)
    local fixed = math.floor(value * scale)
    local clamped = math.clamp(fixed, -32768, 32767)
    buffer.writei16(buf, offset, clamped)
    return offset + 2
end
```

---

### GetService hoisting

Every `game:GetService("X")` call in a file is hoisted to a module-level local on first load. Functions that call `GetService` on every invocation — the most common compiled pattern — pay the registry lookup cost zero times at runtime.

```typescript
// TypeScript source
export function serviceWork(): string {
    const count = game.GetService("Players").GetPlayers().size();
    const running = game.GetService("RunService").IsRunning();
    return `${count}-${running}`;
}
```

```lua
-- Without transformer
local function serviceWork()
    local count = #game:GetService("Players"):GetPlayers()
    local running = game:GetService("RunService"):IsRunning()
    return `{count}-{running}`
end
```

```lua
-- With transformer
--!optimize 2
local _Players = game:GetService("Players")   -- hoisted once at module load
local _RunService = game:GetService("RunService")

local function serviceWork()
    local count = #_Players:GetPlayers()
    local running = _RunService:IsRunning()
    return `{count}-{running}`
end
```

**2.4× faster** — `GetService` calls eliminated from the hot path entirely.

---

### Property chain hoisting

Any property access chain that appears **2 or more times** inside the same function is hoisted to a local. Instance property reads go through Roblox's C++ property system — doing the same read twice is wasted work.

```typescript
// TypeScript source
export function cameraWork(camera: Camera): number {
    const pos = camera.CFrame.Position;
    const look = camera.CFrame.LookVector;  // camera.CFrame read twice
    const fov = camera.FieldOfView;
    return pos.Magnitude + look.X + fov;
}
```

```lua
-- Without transformer
local function cameraWork(camera)
    local pos = camera.CFrame.Position   -- engine call #1
    local look = camera.CFrame.LookVector -- engine call #2
    local fov = camera.FieldOfView
    return pos.Magnitude + look.X + fov
end
```

```lua
-- With transformer
local function cameraWork(camera: Camera)
    local _cache0 = camera.CFrame         -- one engine call
    local pos = _cache0.Position           -- local read
    local look = _cache0.LookVector        -- local read
    local fov = camera.FieldOfView
    return pos.Magnitude + look.X + fov
end
```

**1.5× faster.** Also hoists value type field reads (`.X`, `.Y`, `.Z`) when they appear multiple times — the `cross` function reads each component twice, so all six are hoisted:

```typescript
// TypeScript source
export function cross(a: Vector3, b: Vector3): Vector3 {
    return new Vector3(
        a.Y * b.Z - a.Z * b.Y,
        a.Z * b.X - a.X * b.Z,
        a.X * b.Y - a.Y * b.X,
    );
}
```

```lua
-- Without transformer
local function cross(a, b)
    return Vector3.new(
        a.Y * b.Z - a.Z * b.Y,
        a.Z * b.X - a.X * b.Z,
        a.X * b.Y - a.Y * b.X
    )
end
```

```lua
-- With transformer
local function cross(a: Vector3, b: Vector3)
    local _cache0 = a.Y  -- each component read twice → all hoisted
    local _cache1 = b.Z
    local _cache2 = a.Z
    local _cache3 = b.Y
    local _cache4 = b.X
    local _cache5 = a.X
    return Vector3.new(
        _cache0 * _cache1 - _cache2 * _cache3,
        _cache2 * _cache4 - _cache5 * _cache1,
        _cache5 * _cache3 - _cache0 * _cache4
    )
end
```

**2.7× faster.**

---

### Loop bounds hoisting

`arr.size()` in a `for` loop condition is re-evaluated on every iteration in compiled output. The loops pass hoists it to a `const` before the loop.

```typescript
// TypeScript source
export function sumWeighted(values: Array<number>, weights: Array<number>): number {
    let total = 0;
    for (let i = 0; i < values.size(); i++) {
        total += values[i] * weights[i];
    }
    return total;
}
```

```lua
-- Without transformer
local function sumWeighted(values, weights)
    local total = 0
    for i = 0, #values - 1 do   -- #values evaluated once per iteration
        total += values[i + 1] * weights[i + 1]
    end
    return total
end
```

```lua
-- With transformer
local function sumWeighted(values: {number}, weights: {number})
    local total = 0
    local _len_values = #values   -- hoisted: evaluated once total
    for i = 0, _len_values - 1 do
        total += values[i + 1] * weights[i + 1]
    end
    return total
end
```

**2.3× faster** (combined with `--!native` and type annotations on `values`/`weights`).

---

### Luau type annotation injection

After the compiler writes `.luau` files, the transformer injects Luau type annotations on function parameters. This lets the native compiler generate specialized code for numeric and Roblox value types.

```typescript
// TypeScript source
export function dot(a: Vector3, b: Vector3): number {
    return a.X * b.X + a.Y * b.Y + a.Z * b.Z;
}
```

```lua
-- Without transformer
local function dot(a, b)
    return a.X * b.X + a.Y * b.Y + a.Z * b.Z
end
```

```lua
-- With transformer
local function dot(a: Vector3, b: Vector3)
    return a.X * b.X + a.Y * b.Y + a.Z * b.Z
end
```

Supported types: `number`, `string`, `boolean`, `Vector3`, `Vector2`, `CFrame`, `UDim2`, `Color3`, `buffer`, `Instance`, `BasePart`, `Player`, `Camera`, `RunService`, `Players`, `Workspace`, and array forms (`{number}`, `{Vector3}`, etc.).

---

## Benchmarks

Measured in Roblox Studio server context. 100,000 iterations per benchmark (10,000 for `cfLookAt`). Same TypeScript source compiled two ways — with and without the transformer.

| Benchmark | With transformer | Without | Speedup | Driver |
|-----------|-----------------|---------|---------|--------|
| integrate (Verlet) | 0.042 µs | 0.055 µs | **1.3×** | `--!native` + type annotations |
| dot (V3 manual) | 0.016 µs | 0.032 µs | **2.0×** | `--!native` |
| cross (V3 manual) | 0.018 µs | 0.049 µs | **2.7×** | `--!native` + 6× field hoisting |
| lerpVec3 (V3 manual) | 0.015 µs | 0.047 µs | **3.1×** | `--!native` + 3× field hoisting |
| encodeFixed (buf+math) | 0.015 µs | 0.032 µs | **2.1×** | `--!native` |
| encodePacket (3× fixed) | 0.018 µs | 0.067 µs | **3.7×** | `--!native` stacked across 3 calls |
| sumWeighted (loop) | 0.046 µs | 0.107 µs | **2.3×** | `--!native` + loop bounds hoist |
| dotProduct (loop) | 0.067 µs | 0.109 µs | **1.6×** | `--!native` + loop bounds hoist |
| norm (loop+sqrt) | 0.048 µs | 0.111 µs | **2.3×** | `--!native` + loop bounds hoist |
| mathHeavy (trig+sqrt) | 0.038 µs | 0.052 µs | **1.4×** | `--!native` |
| fib(20) (iter) | 0.048 µs | 0.155 µs | **3.2×** | `--!native` on integer loop |
| cfLookAt (ctor) | 0.079 µs | 0.079 µs | 1.0× | C++ floor — no Luau work |
| cfChain (mul+angles) | 0.076 µs | 0.077 µs | 1.0× | C++ floor — no Luau work |
| serviceWork (GetService ×2) | 0.185 µs | 0.440 µs | **2.4×** | GetService hoisting |
| multiSvc (GetService ×3) | 0.142 µs | 0.480 µs | **3.4×** | GetService hoisting |
| cameraWork (prop chain) | 0.148 µs | 0.215 µs | **1.5×** | `camera.CFrame` hoisted (2 reads → 1) |
| formatStats (template) | 0.170 µs | 0.175 µs | ~1× | String — no arithmetic |
| buildKey (template) | 0.068 µs | 0.086 µs | **1.3×** | `--!native` |

### What the transformer cannot help with

- **Pure engine API calls** — `CFrame.lookAt`, `CFrame.Angles`, `CFrame` multiplication all execute immediately in C++. `--!native` cannot speed up code that is already running natively. `cfLookAt` and `cfChain` show 1.0× for this reason.
- **Single-access properties** — the cache pass only hoists when a property is read 2+ times in the same function. One read has nothing to eliminate.
- **String-heavy functions** — Luau string operations are not meaningfully accelerated by the native compiler.

---

## Development

```bash
npm run build          # build the transformer
npm run bench:rbxlx    # build both versions + produce bench/benchmark.rbxlx
```

Open `bench/benchmark.rbxlx` in Roblox Studio and run the server. The optimized suite prints first, then the baseline suite, sequentially in the output window.
