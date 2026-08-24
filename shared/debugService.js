// debugService.js
const DEBUG_MODE =
  location.hostname === "localhost" ||
  location.hostname === "127.0.0.1" ||
  location.hostname.startsWith("192.168");
	
export function debugLog(tag, ...args) {
  
	if (!DEBUG_MODE) 
    return;

	console.log(
    `🟦 [${tag}]`,
    ...args
  );

}