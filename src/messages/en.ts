// The web app's English text. Every string the app shows comes from here, so
// it can be translated (decision 13).
//
// Write whole sentences, with {name} where a value goes. Translators can't
// reorder a sentence that code builds from pieces. A message with a count
// has a form for each plural category, as Intl.PluralRules names them.
export const en = {
  "app.name": "Accordion",

  "error.offline":
    "Accordion didn't respond. Check that you're on your home network or connected to it, then try again.",
  "error.problem": "Accordion ran into a problem. Try again in a moment.",

  "signIn.title": "Sign in to Accordion",
  "signIn.username": "Username",
  "signIn.password": "Password",
  "signIn.submit": "Sign in",

  "shell.loading": "Loading…",
  "shell.signedInAs": "Signed in as {name}",
  "shell.signOut": "Sign out",
  "shell.mainMenu": "Apps",

  "notFound.title": "Page not found",
  "notFound.body": "There's nothing at this address.",
  "notFound.toDrive": "Go to Drive",

  "drive.title": "Drive",
  "drive.up": "Back to {name}",
  "drive.empty": "This folder is empty.",
  "drive.count": { one: "{count} item", other: "{count} items" },
  "drive.name": "Name",
  "drive.modified": "Modified",
  "drive.size": "Size",
  "drive.folder": "Folder",
  "drive.download": "Download {name}",
} as const;
