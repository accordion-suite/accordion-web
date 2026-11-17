// Adds Docs' text to the app's messages. Docs' entry module imports this
// first, and so does anything tests import on its own.

import { addMessages } from "../i18n.ts";
import { docsEn } from "../messages/docs.en.ts";

addMessages(docsEn);
