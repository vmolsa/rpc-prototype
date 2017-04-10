declare namespace Pako {
	export function deflate(data: Uint8Array | Array<number> | string, options?: any): Uint8Array;
	export function inflate(data: Uint8Array | Array<number> | string, options?: any): Uint8Array;
}

declare module 'pako' {
	export = Pako;
}