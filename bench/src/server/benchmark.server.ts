import * as base from "../shared/fns-bare";
import * as opt from "../shared/fns";

function bench(label: string, n: number, fn: () => void): void {
    task.wait(0.05);
    const t0 = os.clock();
    for (let i = 0; i < n; i++) fn();
    const elapsed = os.clock() - t0;
    print(`  ${label}: ${string.format("%.3f", (elapsed / n) * 1e6)} us/iter`);
}

const N = 100000;
const NS = 10000;

const pos = new Vector3(1, 2, 3);
const vel = new Vector3(0, 1, 0);
const acc = new Vector3(0, -9.8, 0);
const vecA = new Vector3(1, 0, 0);
const vecB = new Vector3(0, 1, 0);
const eye = new Vector3(0, 5, 10);
const tgt = new Vector3(0, 0, 0);
const cf = CFrame.lookAt(eye, tgt);
const buf = buffer.create(256);
const vals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const wts = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
const cam = game.GetService("Workspace").CurrentCamera!;

function runSuite(fns: typeof opt): void {
    bench("integrate   (verlet)", N, () => fns.integrate(pos, vel, acc, 1 / 60));
    bench("dot         (V3 manual)", N, () => fns.dot(vecA, vecB));
    bench("cross       (V3 manual)", N, () => fns.cross(vecA, vecB));
    bench("lerpVec3    (V3 manual)", N, () => fns.lerpVec3(pos, eye, 0.5));
    bench("encodeFixed (buf+math)", N, () => fns.encodeFixed(buf, 0, 3.14, 100));
    bench("encodePacket(3x fixed)", N, () => fns.encodePacket(buf, 1.1, 2.2, 3.3, 100));
    bench("sumWeighted (loop)", N, () => fns.sumWeighted(vals, wts));
    bench("dotProduct  (loop)", N, () => fns.dotProduct(vals, vals));
    bench("norm        (loop+sqrt)", N, () => fns.norm(vals));
    bench("mathHeavy   (trig+sqrt)", N, () => fns.mathHeavy(1.23, 4.56));
    bench("fib(20)     (iter)", N, () => fns.fib(20));
    bench("cfLookAt    (ctor)", NS, () => fns.cfLookAt(eye, tgt));
    bench("cfChain     (mul+angles)", N, () => fns.cfChain(cf, 0.016));
    bench("serviceWork (GetService x2)", N, () => fns.serviceWork());
    bench("multiSvc    (GetService x3)", N, () => fns.multiService());
    bench("cameraWork  (prop chain)", N, () => fns.cameraWork(cam));
    bench("formatStats (template)", N, () => fns.formatStats("speed", 9.81, "m/s"));
    bench("buildKey    (template)", N, () => fns.buildKey("player", 42, "data"));
}

print("\n=== optimized (--!native + transformer) ===");
runSuite(opt);
print("===========================================\n");

task.wait(1);

print("\n=== baseline (plain rotor, no transformer) ===");
runSuite(base);
print("==============================================\n");
