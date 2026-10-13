import { repo, db } from "./domain";
async function illustration(kind: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 800;
  canvas.height = 540;
  const c = canvas.getContext("2d")!;
  const g = c.createLinearGradient(0, 0, 800, 540);
  g.addColorStop(0, kind === 2 ? "#614b43" : "#a6ad93");
  g.addColorStop(1, "#263c32");
  c.fillStyle = g;
  c.fillRect(0, 0, 800, 540);
  c.fillStyle = "#cbd2b7";
  c.beginPath();
  c.ellipse(400, 475, 260, 35, 0, 0, Math.PI * 2);
  c.fill();
  if (kind > 0) {
    c.fillStyle = "#c7a48b";
    c.beginPath();
    c.ellipse(520, 178, 66, 90, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#26352f";
    c.beginPath();
    c.ellipse(520, 430, 125, 160, 0, Math.PI, Math.PI * 2);
    c.fill();
    c.fillStyle = "#322e28";
    c.beginPath();
    c.ellipse(520, 115, 72, 36, -0.1, Math.PI, Math.PI * 2);
    c.fill();
  }
  const x = kind ? 260 : 340;
  c.fillStyle = "#d5d8b3";
  c.beginPath();
  c.roundRect(x, 205, 120, 245, 22);
  c.fill();
  c.fillStyle = "#293c2e";
  c.fillRect(x + 24, 165, 72, 48);
  c.fillStyle = "#334538";
  c.textAlign = "center";
  c.font = "24px Georgia";
  c.fillText(kind === 2 ? "AURA?" : "AURA", x + 60, 300);
  c.font = "11px sans-serif";
  c.fillText("BOTANICAL SERUM", x + 60, 330);
  c.fillText("30 ml / 1 fl oz", x + 60, 405);
  c.textAlign = "left";
  c.fillStyle = "#f2f1dc";
  c.font = "14px sans-serif";
  c.fillText("PRESERVE / FICTIONAL AURA CAMPAIGN", 28, 35);
  c.font = "12px monospace";
  c.fillText("ILLUSTRATIVE SAMPLE • NOT A GENERATED OUTPUT", 28, 512);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(Error("Demo image creation failed."))),
      "image/png",
    ),
  );
}
export async function createDemo() {
  const images = await Promise.all([0, 1, 2].map(illustration));
  return db.transaction(
    "rw",
    [
      db.workflows,
      db.stages,
      db.attempts,
      db.checkpoints,
      db.settings,
      db.annotations,
    ],
    async () => {
      const w = await repo.createWorkflow({
        name: "AURA / Botanical campaign",
        description:
          "Sample project · fictional serum and model, illustrated locally.",
        platform: "Manual / any platform",
        objective:
          "Create a calm botanical serum campaign while preserving product and character identity.",
        sample: true,
      });
      const stages = (
        await db.stages.where({ workflowId: w.id }).toArray()
      ).sort((a, b) => a.order - b.order);
      const a = await repo.addAttempt(stages[0].id);
      a.image = images[0];
      a.prompt.subject = "AURA botanical serum in a minimal studio";
      a.prompt.productDetail =
        "Sage glass bottle, original AURA label, dark green cap";
      a.prompt.lighting = "Soft directional daylight";
      a.notes = "Illustrative sample. Product geometry and label approved.";
      await repo.save(a);
      const cp1 = await repo.approve(a.id);
      const b = await repo.addAttempt(stages[1].id, cp1.id);
      b.image = images[1];
      b.prompt.subject = "Fictional model Mira alongside AURA serum";
      b.prompt.objective = "Establish the campaign character and wardrobe";
      await repo.save(b);
      const cp2 = await repo.approve(b.id);
      const f = await repo.addAttempt(stages[2].id, cp2.id);
      f.image = images[2];
      f.prompt.objective = "Create a model and product advertising frame";
      f.prompt.composition = "Model on the right; product hero on the left";
      await repo.save(f);
      await repo.reject(f.id, {
        categories: ["Product fidelity", "Character identity"],
        explanation:
          "The product label changed and the character no longer matches the approved reference.",
        createdAt: Date.now(),
      });
      await repo.retry(f.id);
      return w;
    },
  );
}
