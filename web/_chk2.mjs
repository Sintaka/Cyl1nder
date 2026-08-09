import { Node } from "@antv/x6";
const C = Node.define({
  name: "cyl1nder",
  markup: [{ tagName: "rect", selector: "body" }],
  attrs: { body: { width: 100, height: 40, fill: "#333" } },
});
console.log("registry.exist:", Node.registry.exist("cyl1nder"));
console.log("registry.get:", !!Node.registry.get("cyl1nder"));
