/**
 * Workspace Plugin
 *
 * Plan management, notepads, verification hooks.
 * Uses Bun-native APIs exclusively (no node: imports).
 */

import { mkdir, readdir, stat } from "fs/promises";
import { join, basename, relative } from "path";
import { homedir } from "os";
import { type Plugin, tool } from "@opencode-ai/plugin";
import { z } from "zod";

// ==========================================
// VERIFICATION HOOKS
// ==========================================

/**
 * Agents that write code and require verification after completion
 */
const IMPLEMENTER_AGENTS = ["coder", "frontend", "build"] as const;

/**
 * Run a command and get stdout using Bun.spawn
 */
async function runCommand(cmd: string[], cwd: string): Promise<string> {
	const proc = Bun.spawn(cmd, {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const output = await new Response(proc.stdout).text();
	await proc.exited;
	return output;
}

/**
 * Get git diff stats to show what files were changed
 */
async function getGitDiffStats(directory: string): Promise<string> {
	try {
		const stdout = await runCommand(
			["git", "diff", "--numstat", "HEAD"],
			directory,
		);

		if (!stdout.trim()) {
			// Check for staged changes
			const stagedOutput = await runCommand(
				["git", "diff", "--numstat", "--cached"],
				directory,
			);
			if (!stagedOutput.trim()) {
				return "No file changes detected.";
			}
			return formatGitStats(stagedOutput);
		}

		return formatGitStats(stdout);
	} catch {
		return "Could not determine file changes.";
	}
}

function formatGitStats(output: string): string {
	const lines = output.trim().split("\n").filter(Boolean);
	if (lines.length === 0) return "No file changes detected.";

	const changes: string[] = [];
	for (const line of lines.slice(0, 10)) {
		// Limit to 10 files
		const [added, removed, file] = line.split("\t");
		if (file) {
			changes.push(`  ${file}: +${added}/-${removed}`);
		}
	}

	if (lines.length > 10) {
		changes.push(`  ... and ${lines.length - 10} more files`);
	}

	return changes.join("\n");
}

/**
 * Build the verification reminder that gets injected after implementer tasks
 */
function buildVerificationReminder(
	agentType: string,
	fileChanges: string,
): string {
	return `
<system-reminder>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ MANDATORY VERIFICATION PROTOCOL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The ${agentType} agent has completed. Subagents can make mistakes.
You MUST verify before marking this task complete.

**Files Changed:**
${fileChanges}

**VERIFICATION STEPS (Do these NOW):**

1. **Type Safety:** Run \`lsp_diagnostics\` on changed files
   → Must return clean (no errors)

2. **Tests:** Run project tests if they exist
   → \`bash\` with test command (bun test, npm test, etc.)

3. **Build:** Run build/typecheck if applicable
   → Must complete without errors

4. **Code Review:** \`Read\` the changed files
   → Verify changes match requirements

**IF VERIFICATION FAILS:**
- Do NOT mark task complete
- Either fix yourself or delegate again with specific fix instructions

**IF VERIFICATION PASSES:**
- Mark task complete in your todo list
- Proceed to next task
</system-reminder>`;
}

// ==========================================
// PROJECT ID CALCULATION
// ==========================================

/**
 * Get project ID from git root commit hash (cross-worktree consistent)
 */
async function getProjectId(directory: string): Promise<string> {
	try {
		const stdout = await runCommand(
			["git", "rev-list", "--max-parents=0", "HEAD"],
			directory,
		);
		return stdout.trim().slice(0, 12);
	} catch {
		// Fallback to directory hash if not a git repo
		const hasher = new Bun.CryptoHasher("sha256");
		hasher.update(directory);
		return hasher.digest("hex").slice(0, 12);
	}
}

// ==========================================
// PLAN SCHEMA & VALIDATION
// ==========================================

const PhaseStatus = z.enum(["PENDING", "IN PROGRESS", "COMPLETE", "BLOCKED"]);

const TaskSchema = z.object({
	id: z
		.string()
		.regex(/^\d+\.\d+$/, "Task ID must be hierarchical (e.g., '2.1')"),
	checked: z.boolean(),
	content: z.string().min(1, "Task content cannot be empty"),
	isCurrent: z.boolean().optional(),
	citation: z
		.string()
		.regex(
			/^ref:[a-z]+-[a-z]+-[a-z]+$/,
			"Citation must be ref:word-word-word format",
		)
		.optional(),
});

const PhaseSchema = z.object({
	number: z.number().int().positive(),
	name: z.string().min(1, "Phase name cannot be empty"),
	status: PhaseStatus,
	tasks: z.array(TaskSchema).min(1, "Phase must have at least one task"),
});

const FrontmatterSchema = z.object({
	status: z.enum(["not-started", "in-progress", "complete", "blocked"]),
	phase: z.number().int().positive(),
	updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
});

const PlanSchema = z.object({
	frontmatter: FrontmatterSchema,
	goal: z.string().min(10, "Goal must be at least 10 characters"),
	context: z
		.array(
			z.object({
				decision: z.string(),
				rationale: z.string(),
				source: z.string(),
			}),
		)
		.optional(),
	phases: z.array(PhaseSchema).min(1, "Plan must have at least one phase"),
});

type ParseResult =
	| { ok: true; data: z.infer<typeof PlanSchema>; warnings: string[] }
	| { ok: false; error: string; hint: string };

interface ExtractedParts {
	frontmatter: Record<string, string | number> | null;
	goal: string | null;
	phases: Array<{
		number: number;
		name: string;
		status: string;
		tasks: Array<{
			id: string;
			checked: boolean;
			content: string;
			isCurrent: boolean;
			citation?: string;
		}>;
	}>;
}

function extractMarkdownParts(content: string): ExtractedParts {
	const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
	let frontmatter: Record<string, string | number> | null = null;

	if (fmMatch) {
		frontmatter = {};
		const fmLines = fmMatch[1].split("\n");
		for (const line of fmLines) {
			const [key, ...valueParts] = line.split(":");
			if (key && valueParts.length > 0) {
				const value = valueParts.join(":").trim();
				frontmatter[key.trim()] =
					key.trim() === "phase" ? parseInt(value, 10) : value;
			}
		}
	}

	// Match ## Goal followed by optional blank lines, then capture the goal text
	const goalMatch = content.match(/## Goal\n\n?([^\n#]+)/);
	const goal = goalMatch?.[1]?.trim() || null;

	const phases: ExtractedParts["phases"] = [];
	const phaseRegex =
		/## Phase (\d+): ([^[]+)\[([^\]]+)\]\n([\s\S]*?)(?=## Phase \d+:|## Notes|## Blockers|$)/g;

	let phaseMatch = phaseRegex.exec(content);
	while (phaseMatch !== null) {
		const phaseNum = parseInt(phaseMatch[1], 10);
		const phaseName = phaseMatch[2].trim();
		const phaseStatus = phaseMatch[3].trim();
		const phaseContent = phaseMatch[4];

		const tasks: ExtractedParts["phases"][0]["tasks"] = [];
		const taskRegex =
			/- \[([ x])\] (\*\*)?(\d+\.\d+) ([^←\n]+)(← CURRENT)?.*?(`ref:[a-z]+-[a-z]+-[a-z]+`)?/g;

		let taskMatch = taskRegex.exec(phaseContent);
		while (taskMatch !== null) {
			tasks.push({
				id: taskMatch[3],
				checked: taskMatch[1] === "x",
				content: taskMatch[4].trim().replace(/\*\*/g, ""),
				isCurrent: !!taskMatch[5],
				citation: taskMatch[6]?.replace(/`/g, ""),
			});
			taskMatch = taskRegex.exec(phaseContent);
		}

		phases.push({
			number: phaseNum,
			name: phaseName,
			status: phaseStatus,
			tasks,
		});
		phaseMatch = phaseRegex.exec(content);
	}

	return { frontmatter, goal, phases };
}

function formatZodErrors(error: z.ZodError): string {
	const errorMessages: string[] = [];

	for (const issue of error.issues) {
		const path = issue.path.length > 0 ? `[${issue.path.join(".")}]` : "[root]";
		let message = issue.message;
		if (issue.code === "invalid_enum_value") {
			const options = (issue as { options?: unknown[] }).options;
			const received = (issue as { received?: unknown }).received;
			message = `Invalid value "${received}". Expected: ${options?.join(" | ") ?? "valid value"}`;
		} else if (
			issue.code === "invalid_type" &&
			(issue as { received?: unknown }).received === "null"
		) {
			message = "Required field missing";
		}
		errorMessages.push(`${path}: ${message}`);
	}

	return errorMessages.join("\n");
}

function parsePlanMarkdown(content: string): ParseResult {
	const skillHint = "Load skill('plan-protocol') for the full format spec.";

	if (typeof content !== "string") {
		return {
			ok: false,
			error: `Expected markdown string, received ${typeof content}`,
			hint: skillHint,
		};
	}

	if (!content.trim()) {
		return {
			ok: false,
			error: "Empty content provided",
			hint: skillHint,
		};
	}

	const parts = extractMarkdownParts(content);
	const candidate = {
		frontmatter: parts.frontmatter,
		goal: parts.goal,
		phases: parts.phases,
	};

	const result = PlanSchema.safeParse(candidate);
	if (!result.success) {
		return {
			ok: false,
			error: formatZodErrors(result.error),
			hint: skillHint,
		};
	}

	const warnings: string[] = [];
	let currentCount = 0;
	let inProgressCount = 0;

	for (const phase of result.data.phases) {
		if (phase.status === "IN PROGRESS") inProgressCount++;
		for (const task of phase.tasks) {
			if (task.isCurrent) currentCount++;
		}
	}

	if (currentCount > 1) {
		return {
			ok: false,
			error: `Multiple tasks marked ← CURRENT (found ${currentCount}). Only one task may be current.`,
			hint: skillHint,
		};
	}

	if (inProgressCount > 1) {
		warnings.push(
			"Multiple phases marked IN PROGRESS. Consider focusing on one phase at a time.",
		);
	}

	return { ok: true, data: result.data, warnings };
}

function formatParseError(error: string, hint: string): string {
	return `❌ Plan validation failed:

${error}

💡 ${hint}`;
}

// Bun-compatible error type guard for filesystem errors
function isSystemError(error: unknown): error is Error & { code: string } {
	return error instanceof Error && "code" in error;
}

// ==========================================
// PLAN STATE MANAGEMENT (Project-Scoped)
// ==========================================

interface ActivePlanState {
	active_plan: string;
	started_at: string;
	session_ids: string[];
	plan_name: string;
}

// Slug generation (from opencode-source)
const ADJECTIVES = [
	"brave",
	"calm",
	"clever",
	"cosmic",
	"crisp",
	"curious",
	"eager",
	"gentle",
	"glowing",
	"happy",
	"hidden",
	"jolly",
	"kind",
	"lucky",
	"mighty",
	"misty",
	"neon",
	"nimble",
	"playful",
	"proud",
	"quick",
	"quiet",
	"shiny",
	"silent",
	"stellar",
	"sunny",
	"swift",
	"tidy",
	"witty",
] as const;

const NOUNS = [
	"cabin",
	"cactus",
	"canyon",
	"circuit",
	"comet",
	"eagle",
	"engine",
	"falcon",
	"forest",
	"garden",
	"harbor",
	"island",
	"knight",
	"lagoon",
	"meadow",
	"moon",
	"mountain",
	"nebula",
	"orchid",
	"otter",
	"panda",
	"pixel",
	"planet",
	"river",
	"rocket",
	"sailor",
	"squid",
	"star",
	"tiger",
	"wizard",
	"wolf",
] as const;

function generateSlug(): string {
	return [
		ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)],
		NOUNS[Math.floor(Math.random() * NOUNS.length)],
	].join("-");
}

function generatePlanPath(plansDir: string): string {
	const timestamp = Date.now();
	const slug = generateSlug();
	const filename = `${timestamp}-${slug}.md`;
	return join(plansDir, filename);
}

function getPlanName(planPath: string): string {
	return basename(planPath, ".md");
}

export const WorkspacePlugin: Plugin = async (ctx) => {
	const { directory } = ctx;

	const projectId = await getProjectId(directory);

	// Legacy session-scoped directory (for migration fallback)
	const legacyBaseDir = join(
		homedir(),
		".local",
		"share",
		"opencode",
		"workspace",
		projectId,
	);

	// New project-scoped directories
	const workspaceDir = join(directory, ".opencode", "workspace");
	const plansDir = join(workspaceDir, "plans");
	const notepadsDir = join(workspaceDir, "notepads");
	const activePlanPath = join(workspaceDir, "active-plan.json");

	// Notepad file types
	const NOTEPAD_FILES = ["learnings.md", "issues.md", "decisions.md"] as const;
	type NotepadFile = (typeof NOTEPAD_FILES)[number];

	async function getRootSessionID(sessionID?: string): Promise<string> {
		if (!sessionID) {
			throw new Error("sessionID is required to resolve root session scope");
		}

		let currentID = sessionID;
		for (let depth = 0; depth < 10; depth++) {
			const session = await ctx.client.session.get({
				path: { id: currentID },
			});

			if (!session.data?.parentID) {
				return currentID;
			}

			currentID = session.data.parentID;
		}

		throw new Error(
			"Failed to resolve root session: maximum traversal depth exceeded",
		);
	}

	async function readActivePlanState(): Promise<ActivePlanState | null> {
		try {
			const file = Bun.file(activePlanPath);
			if (!(await file.exists())) return null;
			const content = await file.text();
			return JSON.parse(content) as ActivePlanState;
		} catch (error) {
			if (isSystemError(error) && error.code === "ENOENT") return null;
			throw error;
		}
	}

	async function writeActivePlanState(state: ActivePlanState): Promise<void> {
		await mkdir(workspaceDir, { recursive: true });
		await Bun.write(activePlanPath, JSON.stringify(state, null, 2));
	}

	async function appendSessionToActivePlan(sessionID: string): Promise<void> {
		const state = await readActivePlanState();
		if (!state) return;

		if (!state.session_ids.includes(sessionID)) {
			state.session_ids.push(sessionID);
			await writeActivePlanState(state);
		}
	}

	// ==========================================
	// NOTEPAD HELPERS
	// ==========================================

	async function getNotepadDir(): Promise<string | null> {
		const activePlan = await readActivePlanState();
		if (!activePlan) return null;
		return join(notepadsDir, activePlan.plan_name);
	}

	async function ensureNotepadDir(): Promise<string | null> {
		const notepadDir = await getNotepadDir();
		if (!notepadDir) return null;
		await mkdir(notepadDir, { recursive: true });
		return notepadDir;
	}

	async function readNotepadFile(file: NotepadFile): Promise<string | null> {
		const notepadDir = await getNotepadDir();
		if (!notepadDir) return null;

		try {
			const filePath = join(notepadDir, file);
			const bunFile = Bun.file(filePath);
			if (!(await bunFile.exists())) return null;
			return await bunFile.text();
		} catch (error) {
			if (isSystemError(error) && error.code === "ENOENT") return null;
			throw error;
		}
	}

	async function appendToNotepadFile(
		file: NotepadFile,
		content: string,
	): Promise<void> {
		const notepadDir = await ensureNotepadDir();
		if (!notepadDir)
			throw new Error("No active plan. Create a plan first with /plan.");

		const filePath = join(notepadDir, file);
		const timestamp = new Date().toISOString().slice(0, 10);
		const entry = `\n## ${timestamp}\n${content.trim()}\n`;

		const bunFile = Bun.file(filePath);
		if (await bunFile.exists()) {
			const existing = await bunFile.text();
			await Bun.write(filePath, existing + entry);
		} else {
			// Create file with header
			const header = `# ${file.replace(".md", "").charAt(0).toUpperCase() + file.replace(".md", "").slice(1)}\n`;
			await Bun.write(filePath, header + entry);
		}
	}

	return {
		tool: {
			plan_save: tool({
				description:
					"Save the implementation plan as markdown. Must include citations (ref:delegation-id) for decisions based on research. Plan is validated before saving.",
				args: {
					content: tool.schema
						.string()
						.describe("The full plan in markdown format"),
				},
				async execute(args, toolCtx) {
					if (!toolCtx?.sessionID) {
						return "❌ plan_save requires sessionID. This is a system error.";
					}

					const result = parsePlanMarkdown(args.content);
					if (!result.ok) {
						return formatParseError(result.error, result.hint);
					}

					const existingState = await readActivePlanState();
					let planPath: string;
					let isNewPlan = false;

					if (existingState) {
						planPath = existingState.active_plan;

						if (!existingState.session_ids.includes(toolCtx.sessionID)) {
							existingState.session_ids.push(toolCtx.sessionID);
							await writeActivePlanState(existingState);
						}
						} else {
							await mkdir(plansDir, { recursive: true });
							planPath = generatePlanPath(plansDir);
							isNewPlan = true;

							const state: ActivePlanState = {
								active_plan: planPath,
								started_at: new Date().toISOString(),
								session_ids: [toolCtx.sessionID],
								plan_name: getPlanName(planPath),
							};
							await writeActivePlanState(state);
						}

						await Bun.write(planPath, args.content);

					const warningCount = result.warnings?.length ?? 0;
					const warningText =
						warningCount > 0
							? ` (${warningCount} warnings: ${result.warnings?.join(", ")})`
					: "";

				const relativePath = relative(directory, planPath);
					const action = isNewPlan ? "created" : "updated";

					return `Plan ${action} at ${relativePath}.${warningText}`;
				},
			}),

			plan_read: tool({
				description: "Read the current implementation plan for this session.",
				args: {
					reason: tool.schema
						.string()
						.describe("Brief explanation of why you are calling this tool"),
				},
				async execute(_args, toolCtx) {
					if (!toolCtx?.sessionID) {
						return "❌ plan_read requires sessionID. This is a system error.";
					}

					// 1. Try project-scoped active plan first
					const activePlan = await readActivePlanState();
					if (activePlan) {
					await appendSessionToActivePlan(toolCtx.sessionID);

					try {
						const planFile = Bun.file(activePlan.active_plan);
						if (!(await planFile.exists())) {
							return `❌ Active plan file not found at ${activePlan.active_plan}. The plan may have been deleted.`;
						}
						return await planFile.text();
					} catch (error) {
						if (isSystemError(error) && error.code === "ENOENT") {
							return `❌ Active plan file not found at ${activePlan.active_plan}. The plan may have been deleted.`;
						}
						throw error;
					}
				}

				// 2. Fall back to legacy session-scoped plan
				const rootID = await getRootSessionID(toolCtx.sessionID);
				const legacyPlanPath = join(legacyBaseDir, rootID, "plan.md");
				try {
					const legacyFile = Bun.file(legacyPlanPath);
					if (!(await legacyFile.exists())) {
						return "No plan found. Use /plan to create a new plan.";
					}
					const content = await legacyFile.text();
					return `${content}\n\n---\n<migration-notice>\nThis plan is from the legacy session-scoped storage. Next time you save, it will be migrated to project-scoped storage at .opencode/workspace/plans/\n</migration-notice>`;
					} catch (error) {
						if (isSystemError(error) && error.code === "ENOENT") {
							return "No plan found. Use /plan to create a new plan.";
						}
						throw error;
					}
				},
			}),

			plan_list: tool({
				description:
					"List all plans in this project. Shows active plan and completed plans.",
				args: {},
				async execute(_args, toolCtx) {
					if (!toolCtx?.sessionID) {
						return "❌ plan_list requires sessionID. This is a system error.";
					}

					const activePlan = await readActivePlanState();

				let allPlans: string[] = [];
				try {
					await mkdir(plansDir, { recursive: true });
					const files = await readdir(plansDir);
					allPlans = files
						.filter((f) => f.endsWith(".md"))
						.map((f) => join(plansDir, f))
						.sort()
						.reverse(); // Newest first
				} catch (error) {
					if (!isSystemError(error) || error.code !== "ENOENT") throw error;
				}

					if (allPlans.length === 0) {
						return "No plans found in .opencode/workspace/plans/. Use /plan to create one.";
					}

					const planList: string[] = [];

					if (activePlan) {
					planList.push(`## Active Plan\n`);
					planList.push(`**Name**: ${activePlan.plan_name}`);
					planList.push(
						`**Path**: ${relative(directory, activePlan.active_plan)}`,
					);
					planList.push(`**Started**: ${activePlan.started_at}`);
					planList.push(
						`**Sessions**: ${activePlan.session_ids.length} session(s) have worked on this plan`,
					);
					planList.push(``);
				}

				const otherPlans = allPlans.filter(
					(p) => p !== activePlan?.active_plan,
				);
				if (otherPlans.length > 0) {
					planList.push(`## Other Plans (${otherPlans.length})`);
					for (const planPath of otherPlans) {
						const stats = await stat(planPath);
						const name = getPlanName(planPath);
						const relativePath = relative(directory, planPath);
							planList.push(
								`- **${name}**: ${relativePath} (modified: ${stats.mtime.toISOString()})`,
							);
						}
					}

					return planList.join("\n");
				},
			}),

			// ==========================================
			// NOTEPAD TOOLS
			// ==========================================

			notepad_read: tool({
				description:
					"Read accumulated wisdom from the notepad for the active plan. Returns learnings, issues, and decisions discovered during implementation. ALWAYS read before delegating tasks to pass inherited wisdom.",
				args: {
					file: tool.schema
						.enum(["all", "learnings", "issues", "decisions"])
						.optional()
						.describe("Which notepad file to read. Defaults to 'all'."),
				},
				async execute(args) {
					const notepadDir = await getNotepadDir();
					if (!notepadDir) {
						return "No active plan. Create a plan first with /plan, then use notepad to record learnings.";
					}

					const fileToRead = args.file ?? "all";
					const results: string[] = [];

					if (fileToRead === "all") {
						for (const file of NOTEPAD_FILES) {
							const content = await readNotepadFile(file);
							if (content) {
								results.push(`--- ${file} ---\n${content}`);
							}
						}
					} else {
						const content = await readNotepadFile(
							`${fileToRead}.md` as NotepadFile,
						);
						if (content) {
							results.push(content);
						}
					}

					if (results.length === 0) {
						const activePlan = await readActivePlanState();
						return `Notepad is empty for plan "${activePlan?.plan_name}". Use notepad_write to record learnings, issues, or decisions.`;
					}

					return results.join("\n\n");
				},
			}),

			notepad_write: tool({
				description:
					"Append learnings, issues, or decisions to the notepad for the active plan. Use this to persist wisdom across sessions and share with subagents.",
				args: {
					file: tool.schema
						.enum(["learnings", "issues", "decisions"])
						.describe(
							"Which notepad file to write to. learnings=patterns/conventions, issues=gotchas/problems, decisions=rationales",
						),
					content: tool.schema
						.string()
						.describe(
							"The content to append. Will be timestamped automatically.",
						),
				},
				async execute(args) {
					try {
					await appendToNotepadFile(
						`${args.file}.md` as NotepadFile,
						args.content,
					);
					const notepadDir = await getNotepadDir();
					const relativePath = relative(directory, notepadDir!);
					return `✅ Appended to ${relativePath}/${args.file}.md`;
				} catch (error) {
					if (error instanceof Error) {
						return `❌ ${error.message}`;
					}
					throw error;
				}
			},
		}),

		notepad_list: tool({
			description:
				"List all notepad files for the active plan with their sizes.",
			args: {},
			async execute() {
				const notepadDir = await getNotepadDir();
				if (!notepadDir) {
					return "No active plan. Create a plan first with /plan.";
				}

				const activePlan = await readActivePlanState();
				const results: string[] = [
					`## Notepad for "${activePlan?.plan_name}"\n`,
				];
				results.push(`Path: ${relative(directory, notepadDir)}/\n`);

				let hasFiles = false;
				for (const file of NOTEPAD_FILES) {
					try {
						const filePath = join(notepadDir, file);
						const bunFile = Bun.file(filePath);
						if (!(await bunFile.exists())) {
							results.push(`- **${file}**: (not created)`);
							continue;
						}
						const stats = await stat(filePath);
						const content = await bunFile.text();
						const lineCount = content.split("\n").length;
						results.push(
							`- **${file}**: ${lineCount} lines, ${stats.size} bytes`,
						);
						hasFiles = true;
					} catch (error) {
						if (isSystemError(error) && error.code === "ENOENT") {
							results.push(`- **${file}**: (not created)`);
						} else {
							throw error;
						}
					}
				}

					if (!hasFiles) {
						results.push(
							"\nNo notepad files yet. Use notepad_write to start recording wisdom.",
						);
					}

					return results.join("\n");
				},
			}),
		},

		// ==========================================
		// VERIFICATION HOOKS
		// ==========================================
		hook: {
			"tool.execute.after": async (
				input: { tool: string; args?: unknown },
				output: { output?: string },
			) => {
				// Only intercept the 'task' tool
				if (input.tool !== "task") return;

				// Check if this was an implementer agent task
				const args = input.args as { subagent_type?: string } | undefined;
				const agentType = args?.subagent_type;

				if (
					!agentType ||
					!IMPLEMENTER_AGENTS.includes(
						agentType as (typeof IMPLEMENTER_AGENTS)[number],
					)
				) {
					return; // Not an implementer agent, skip verification
				}

				// Get file changes to show what was modified
				const fileChanges = await getGitDiffStats(directory);

				// Append verification reminder to the tool output
				const reminder = buildVerificationReminder(agentType, fileChanges);

				if (typeof output.output === "string") {
					output.output = output.output + reminder;
				}
			},
		},
	};
};
