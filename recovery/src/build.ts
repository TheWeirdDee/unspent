declare const __BUILD_COMMIT__: string;
/** Git commit this bundle was built from (set by the host at build time; "dev" locally). */
export const BUILD_COMMIT: string = typeof __BUILD_COMMIT__ === "string" ? __BUILD_COMMIT__ : "dev";
