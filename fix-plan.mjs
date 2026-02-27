import { writeFileSync, readFileSync } from "node:fs";
const plan = readFileSync("deployments/default.simnet-plan.yaml", "utf8");
const fixed = plan.replace(
  /- transaction-type: (\S+)\n(\s+)contract-name: (\S+)\n\s+emulated-sender: (\S+)\n\s+path: (\S+)\n\s+clarity-version: (\S+)/g,
  "- $1:\n$2    contract-name: $3\n$2    emulated-sender: $4\n$2    path: $5\n$2    clarity-version: $6"
);
if (fixed !== plan) {
  writeFileSync("deployments/default.simnet-plan.yaml", fixed);
  console.log("Fixed deployment plan format");
}
