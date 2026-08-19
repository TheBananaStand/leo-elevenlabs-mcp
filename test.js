process.env.LEO_MCP_NO_SERVE = "1";
const { toVoices } = await import("./index.js");
const assert = await import("node:assert/strict");

const mapped = toVoices({
  voices: [
    { voice_id: "r1", name: "Rachel", labels: { accent: "British" } },
    { voice_id: "r2" },
    { name: "no id — dropped" },
  ],
});
assert.equal(mapped.length, 2);
assert.deepEqual(mapped[0], { id: "r1", name: "Rachel", detail: "British" });
// An unnamed voice is still selectable; its id is a usable label.
assert.equal(mapped[1].name, "r2");
// `detail` absent rather than empty — an empty clause renders as a blank line.
assert.equal("detail" in mapped[1], false);

// Empty is a legitimate answer ("one voice, nothing to choose between"), so
// none of these may throw.
for (const junk of [{}, { voices: null }, { voices: "nope" }, null, undefined]) {
  assert.deepEqual(toVoices(junk), []);
}
console.log("ok — elevenlabs voice mapping holds");
