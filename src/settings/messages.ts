// Adds Settings' text to the app's messages. Settings' entry module imports
// this first, and so does anything tests import on its own.

import { addMessages } from "../i18n.ts";
import { settingsEn } from "../messages/settings.en.ts";

addMessages(settingsEn);
