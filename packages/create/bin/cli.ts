#!/usr/bin/env bun
/**
 * op1 CLI - Interactive installer for OpenCode harness
 * Usage: bunx @op1/create
 */

import { main } from "@/index";

main().catch((error) => {
	console.error("Error:", error);
	process.exit(1);
});
