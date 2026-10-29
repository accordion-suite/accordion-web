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
  "drive.upload": "Upload files",
  "drive.dropHere": "Drop files to upload them to {folder}",
  "drive.noFolders":
    "Accordion can't upload folders yet. Open the folder on your device, then upload the files inside it.",

  "uploads.title": "Uploads",
  "uploads.uploading": { one: "Uploading {count} file", other: "Uploading {count} files" },
  "uploads.uploaded": { one: "{count} file uploaded", other: "{count} files uploaded" },
  "uploads.waiting": "Waiting",
  "uploads.sent": "{sent} of {size}",
  "uploads.retrying": "The connection dropped. Trying again…",
  "uploads.saving": "Saving…",
  "uploads.done": "Uploaded to {folder}",
  "uploads.canceled": "Canceled",
  "uploads.cancel": "Cancel",
  "uploads.cancelNamed": "Cancel uploading {name}",
  "uploads.progressOf": "Uploading {name}",
  "uploads.clear": "Clear finished",
  "uploads.hide": "Hide",
  "uploads.show": "Show",
  "uploads.announceDone": "{name} uploaded.",
  "uploads.announceFailed": "{name} didn't upload. {problem}",
  "uploads.gone":
    "Accordion removed this upload, such as after a day without progress. Upload the file again.",
} as const;
