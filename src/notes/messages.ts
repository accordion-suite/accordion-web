// Adds Notes' text to the app's messages. Notes' entry module imports this
// first, and so does anything tests import on its own.

import { addMessages } from "../i18n.ts";
import { notesEn } from "../messages/notes.en.ts";

addMessages(notesEn);
