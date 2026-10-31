import { render } from "preact";

import "./app.css";
import { App } from "./shell/app.tsx";
import { applyAppearance, savedAppearance } from "./shell/appearance.ts";

applyAppearance(savedAppearance());

const root = document.getElementById("app");
if (root) render(<App />, root);
