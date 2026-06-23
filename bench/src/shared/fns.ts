//!native

// ── Vector3 / physics ────────────────────────────────────────────────────────

export function integrate(pos: Vector3, vel: Vector3, acc: Vector3, dt: number): [Vector3, Vector3] {
    const newVel = vel.add(acc.mul(dt));
    const newPos = pos.add(newVel.mul(dt));
    return [newPos, newVel];
}

export function dot(a: Vector3, b: Vector3): number {
    return a.X * b.X + a.Y * b.Y + a.Z * b.Z;
}

export function cross(a: Vector3, b: Vector3): Vector3 {
    return new Vector3(
        a.Y * b.Z - a.Z * b.Y,
        a.Z * b.X - a.X * b.Z,
        a.X * b.Y - a.Y * b.X,
    );
}

export function lerpVec3(a: Vector3, b: Vector3, t: number): Vector3 {
    return new Vector3(
        a.X + (b.X - a.X) * t,
        a.Y + (b.Y - a.Y) * t,
        a.Z + (b.Z - a.Z) * t,
    );
}

// ── Buffer / encoding ────────────────────────────────────────────────────────

export function encodeFixed(buf: buffer, offset: number, value: number, scale: number): number {
    const fixed = math.floor(value * scale);
    const clamped = math.clamp(fixed, -32768, 32767);
    buffer.writei16(buf, offset, clamped);
    return offset + 2;
}

export function encodePacket(buf: buffer, x: number, y: number, z: number, scale: number): void {
    let off = 0;
    off = encodeFixed(buf, off, x, scale);
    off = encodeFixed(buf, off, y, scale);
    encodeFixed(buf, off, z, scale);
}

// ── Math / arithmetic ────────────────────────────────────────────────────────

export function sumWeighted(values: Array<number>, weights: Array<number>): number {
    let total = 0;
    for (let i = 0; i < values.size(); i++) {
        total += values[i] * weights[i];
    }
    return total;
}

export function dotProduct(a: Array<number>, b: Array<number>): number {
    let sum = 0;
    for (let i = 0; i < a.size(); i++) {
        sum += a[i] * b[i];
    }
    return sum;
}

export function norm(values: Array<number>): number {
    let sq = 0;
    for (let i = 0; i < values.size(); i++) {
        sq += values[i] * values[i];
    }
    return math.sqrt(sq);
}

export function mathHeavy(x: number, y: number): number {
    return math.sin(x) * math.cos(y) + math.sqrt(x * x + y * y) + math.atan2(y, x);
}

export function fib(n: number): number {
    if (n <= 1) return n;
    let a = 0;
    let b = 1;
    for (let i = 2; i <= n; i++) {
        const tmp = a + b;
        a = b;
        b = tmp;
    }
    return b;
}

// ── CFrame ───────────────────────────────────────────────────────────────────

export function cfLookAt(eye: Vector3, target: Vector3): CFrame {
    return CFrame.lookAt(eye, target);
}

export function cfChain(cf: CFrame, dt: number): CFrame {
    return cf.mul(CFrame.Angles(0, dt, 0));
}

// ── Services / instance ──────────────────────────────────────────────────────

export function serviceWork(): string {
    const count = game.GetService("Players").GetPlayers().size();
    const running = game.GetService("RunService").IsRunning();
    return `${count}-${running}`;
}

export function multiService(): boolean {
    const players = game.GetService("Players");
    const rs = game.GetService("RunService");
    const ws = game.GetService("Workspace");
    return rs.IsRunning() && players.MaxPlayers > 0 && ws.Gravity > 0;
}

export function cameraWork(camera: Camera): number {
    const pos = camera.CFrame.Position;
    const look = camera.CFrame.LookVector;
    const fov = camera.FieldOfView;
    return pos.Magnitude + look.X + fov;
}

// ── String ───────────────────────────────────────────────────────────────────

export function formatStats(label: string, value: number, unit: string): string {
    return `${label}: ${string.format("%.4f", value)} ${unit}`;
}

export function buildKey(prefix: string, id: number, suffix: string): string {
    return `${prefix}_${id}_${suffix}`;
}
