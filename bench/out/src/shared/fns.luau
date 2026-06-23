--!optimize 2
--!native

-- Compiled with rotor v2.2.0

-- Services
local _RunService = game:GetService("RunService")
local _Workspace = game:GetService("Workspace")
local _Players = game:GetService("Players")

local function integrate(pos: Vector3, vel: Vector3, acc: Vector3, dt: number)
	local _vel = vel
	local _acc = acc
	local _dt = dt
	const newVel = _vel + (_acc * _dt)

	local _pos = pos
	local _dt_1 = dt
	local _arg0 = newVel * _dt_1
	const newPos = _pos + _arg0

	return { newPos, newVel }
end

local function dot(a: Vector3, b: Vector3): number
	return a.X * b.X + a.Y * b.Y + a.Z * b.Z
end

local function cross(a: Vector3, b: Vector3): Vector3
	local _cache0 = a.Y
	local _cache1 = b.Z
	local _cache2 = a.Z
	local _cache3 = b.Y
	local _cache4 = b.X
	local _cache5 = a.X

	return Vector3.new(_cache0 * _cache1 - _cache2 * _cache3, _cache2 * _cache4 - _cache5 * _cache1, _cache5 * _cache3 - _cache0 * _cache4)
end

local function lerpVec3(a: Vector3, b: Vector3, t: number): Vector3
	local _cache0 = a.X
	local _cache1 = a.Y
	local _cache2 = a.Z

	return Vector3.new(_cache0 + (b.X - _cache0) * t, _cache1 + (b.Y - _cache1) * t, _cache2 + (b.Z - _cache2) * t)
end

-- ── Buffer / encoding ────────────────────────────────────────────────────────

local function encodeFixed(buf: buffer, offset: number, value: number, scale: number): number
	const fixed = math.floor(value * scale)
	const clamped = math.clamp(fixed, -32768, 32767)
	buffer.writei16(buf, offset, clamped)

	return offset + 2
end

local function encodePacket(buf: buffer, x: number, y: number, z: number, scale: number)
	local off = 0
	off = encodeFixed(buf, off, x, scale)
	off = encodeFixed(buf, off, y, scale)
	encodeFixed(buf, off, z, scale)
end

-- ── Math / arithmetic ────────────────────────────────────────────────────────

local function sumWeighted(values: {number}, weights: {number}): number
	local total = 0

	do
		local _len_values = #values

		do
			local i = 0
			local _shouldIncrement = false

			while true do
				if _shouldIncrement then
					i += 1
				else
					_shouldIncrement = true
				end

				if not (i < _len_values) then
					break
				end

				total += values[i + 1] * weights[i + 1]
			end
		end
	end

	return total
end

local function dotProduct(a: {number}, b: {number}): number
	local sum = 0

	do
		local _len_a = #a

		do
			local i = 0
			local _shouldIncrement = false

			while true do
				if _shouldIncrement then
					i += 1
				else
					_shouldIncrement = true
				end

				if not (i < _len_a) then
					break
				end

				sum += a[i + 1] * b[i + 1]
			end
		end
	end

	return sum
end

local function norm(values: {number}): number
	local sq = 0

	do
		local _len_values = #values

		do
			local i = 0
			local _shouldIncrement = false

			while true do
				if _shouldIncrement then
					i += 1
				else
					_shouldIncrement = true
				end

				if not (i < _len_values) then
					break
				end

				sq += values[i + 1] * values[i + 1]
			end
		end
	end

	return math.sqrt(sq)
end

local function mathHeavy(x: number, y: number): number
	return math.sin(x) * math.cos(y) + math.sqrt(x * x + y * y) + math.atan2(y, x)
end

local function fib(n: number): number

	if n <= 1 then
		return n
	end

	local a = 0
	local b = 1

	do
		local i = 2
		local _shouldIncrement = false

		while true do
			if _shouldIncrement then
				i += 1
			else
				_shouldIncrement = true
			end

			if not (i <= n) then
				break
			end

			const tmp = a + b
			a = b
			b = tmp
		end
	end

	return b
end

-- ── CFrame ───────────────────────────────────────────────────────────────────

local function cfLookAt(eye: Vector3, target: Vector3): CFrame
	return CFrame.lookAt(eye, target)
end

local function cfChain(cf: CFrame, dt: number): CFrame
	local _cf = cf
	local _arg0 = CFrame.Angles(0, dt, 0)

	return _cf * _arg0
end

-- ── Services / instance ──────────────────────────────────────────────────────

local function serviceWork(): string
	const count = #_Players:GetPlayers()
	const running = _RunService:IsRunning()

	return `{count}-{running}`
end

local function multiService(): boolean
	const players = _Players
	const rs = _RunService
	const ws = _Workspace

	return rs:IsRunning() and players.MaxPlayers > 0 and ws.Gravity > 0
end

local function cameraWork(camera: Camera): number
	local _cache0 = camera.CFrame
	const pos = _cache0.Position
	const look = _cache0.LookVector
	const fov = camera.FieldOfView

	return pos.Magnitude + look.X + fov
end

-- ── String ───────────────────────────────────────────────────────────────────

local function formatStats(label: string, value: number, unit: string): string
	return `{label}: {string.format("%.4f", value)} {unit}`
end

local function buildKey(prefix: string, id: number, suffix: string): string
	return `{prefix}_{id}_{suffix}`
end

return {
	integrate = integrate,
	dot = dot,
	cross = cross,
	lerpVec3 = lerpVec3,
	encodeFixed = encodeFixed,
	encodePacket = encodePacket,
	sumWeighted = sumWeighted,
	dotProduct = dotProduct,
	norm = norm,
	mathHeavy = mathHeavy,
	fib = fib,
	cfLookAt = cfLookAt,
	cfChain = cfChain,
	serviceWork = serviceWork,
	multiService = multiService,
	cameraWork = cameraWork,
	formatStats = formatStats,
	buildKey = buildKey,
}
