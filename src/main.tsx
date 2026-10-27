import { render } from "preact";

import "./app.css";
import { App } from "./shell/app.tsx";

const root = document.getElementById("app");
if (root) render(<App />, root);
