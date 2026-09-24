export let lastExtension=null;
export function noteExtension(value){lastExtension={extensionVersion:String(value.extensionVersion||'unknown').slice(0,30),hostVersion:String(value.hostVersion||'unknown').slice(0,30),seenAt:Date.now()};}
