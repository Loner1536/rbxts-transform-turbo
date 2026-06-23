--!optimize 2

-- Compiled with rotor v2.2.0

-- Runtime
local TS = require(_ReplicatedStorage:WaitForChild("include"):WaitForChild("RuntimeLib"))

-- Services
local _ReplicatedStorage = game:GetService("ReplicatedStorage")
local _Workspace = game:GetService("Workspace")

-- Imports
local base = TS.import(script, _ReplicatedStorage, "shared", "fns-bare")
local opt = TS.import(script, _ReplicatedStorage, "shared", "fns")

local function bench(label: string, n: number, fn)
	local _cache0 = os.clock
	task.wait(0.05)
	const t0 = _cache0()

	do
		local i = 0
		local _shouldIncrement = false

		while true do
			if _shouldIncrement then
				i += 1
			else
				_shouldIncrement = true
			end

			if not (i < n) then
				break
			end

			fn()
		end
	end

	const elapsed = _cache0() - t0
	print(`  {label}: {string.format("%.3f", (elapsed / n) * 1e6)} us/iter`)
end

const N = 100000
const NS = 10000
const pos = Vector3.new(1, 2, 3)
const vel = Vector3.new(0, 1, 0)
const acc = Vector3.new(0, -9.8, 0)
const vecA = Vector3.new(1, 0, 0)
const vecB = Vector3.new(0, 1, 0)
const eye = Vector3.new(0, 5, 10)
const tgt = Vector3.new(0, 0, 0)
const cf = CFrame.lookAt(eye, tgt)
const buf = buffer.create(256)
const vals = { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 }
const wts = { 1, 1, 1, 1, 1, 1, 1, 1, 1, 1 }
const cam = _Workspace.CurrentCamera

local function runSuite(fns)
	bench("integrate   (verlet)", N, function()
		return fns.integrate(pos, vel, acc, 1 / 60)
	end)
	bench("dot         (V3 manual)", N, function()
		return fns.dot(vecA, vecB)
	end)
	bench("cross       (V3 manual)", N, function()
		return fns.cross(vecA, vecB)
	end)
	bench("lerpVec3    (V3 manual)", N, function()
		return fns.lerpVec3(pos, eye, 0.5)
	end)
	bench("encodeFixed (buf+math)", N, function()
		return fns.encodeFixed(buf, 0, 3.14, 100)
	end)
	bench("encodePacket(3x fixed)", N, function()
		return fns.encodePacket(buf, 1.1, 2.2, 3.3, 100)
	end)
	bench("sumWeighted (loop)", N, function()
		return fns.sumWeighted(vals, wts)
	end)
	bench("dotProduct  (loop)", N, function()
		return fns.dotProduct(vals, vals)
	end)
	bench("norm        (loop+sqrt)", N, function()
		return fns.norm(vals)
	end)
	bench("mathHeavy   (trig+sqrt)", N, function()
		return fns.mathHeavy(1.23, 4.56)
	end)
	bench("fib(20)     (iter)", N, function()
		return fns.fib(20)
	end)
	bench("cfLookAt    (ctor)", NS, function()
		return fns.cfLookAt(eye, tgt)
	end)
	bench("cfChain     (mul+angles)", N, function()
		return fns.cfChain(cf, 0.016)
	end)
	bench("serviceWork (GetService x2)", N, function()
		return fns.serviceWork()
	end)
	bench("multiSvc    (GetService x3)", N, function()
		return fns.multiService()
	end)
	bench("cameraWork  (prop chain)", N, function()
		return fns.cameraWork(cam)
	end)
	bench("formatStats (template)", N, function()
		return fns.formatStats("speed", 9.81, "m/s")
	end)
	bench("buildKey    (template)", N, function()
		return fns.buildKey("player", 42, "data")
	end)
end

print("\n=== optimized (--!native + transformer) ===")
runSuite(opt)
print("===========================================\n")
task.wait(1)
print("\n=== baseline (plain rotor, no transformer) ===")
runSuite(base)
print("==============================================\n")
