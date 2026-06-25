export interface PluginConfig {
    // Prepend --!optimize <level> to every file that doesn't already have it,
    // where <level> is optimizeLevel (0-2).
    // Default: false
    optimize?: boolean;

    // The optimization level to use when optimize is enabled, i.e. the X in
    // --!optimize X. Valid values are 0, 1, or 2 — see Luau's --!optimize
    // directive docs for what each level does.
    // Default: 2
    optimizeLevel?: 0 | 1 | 2;

    // Prepend --!strict to every file that doesn't already have it.
    // Default: true
    strict?: boolean;

    // Hoist repeated game.GetService() calls to module-level locals,
    // and hoist repeated property access chains within functions to locals.
    // Default: true
    hoist?: boolean;

    // Add logging to compile output
    // Default: false
    verbose?: boolean
}
