/**
 * op1 CLI Installer
 *
 * Interactive installer that scaffolds op1 config into user's project.
 * Supports selective installation of components.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";

const TEMPLATES_DIR = path.join(import.meta.dir, "..", "templates");

interface InstallOptions {
	agents: boolean;
	commands: boolean;
	skills: boolean;
	plugins: boolean;
	config: boolean;
}

interface PluginChoice {
	notify: boolean;
	workspace: boolean;
}

async function copyDir(src: string, dest: string): Promise<number> {
	let count = 0;
	await fs.mkdir(dest, { recursive: true });

	const entries = await fs.readdir(src, { withFileTypes: true });
	for (const entry of entries) {
		const srcPath = path.join(src, entry.name);
		const destPath = path.join(dest, entry.name);

		if (entry.isDirectory()) {
			count += await copyDir(srcPath, destPath);
		} else {
			await fs.copyFile(srcPath, destPath);
			count++;
		}
	}
	return count;
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

export async function main() {
	console.clear();

	p.intro(
		`${pc.bgCyan(pc.black(" op1 "))} ${pc.dim("OpenCode harness installer")}`,
	);

	const cwd = process.cwd();
	const opencodeDir = path.join(cwd, ".opencode");

	// Check if .opencode already exists
	const existingConfig = await fileExists(opencodeDir);
	if (existingConfig) {
		const shouldContinue = await p.confirm({
			message: `${pc.yellow(".opencode")} directory already exists. Continue and merge?`,
			initialValue: true,
		});

		if (p.isCancel(shouldContinue) || !shouldContinue) {
			p.cancel("Installation cancelled.");
			process.exit(0);
		}
	}

	// Component selection
	const components = await p.multiselect({
		message: "What would you like to install?",
		options: [
			{
				value: "agents",
				label: "Agents",
				hint: "9 specialized agents (build, coder, explore, etc.)",
			},
			{
				value: "commands",
				label: "Commands",
				hint: "6 slash commands (/plan, /review, /ulw, etc.)",
			},
			{
				value: "skills",
				label: "Skills",
				hint: "17 loadable skills (code-philosophy, playwright, etc.)",
			},
			{
				value: "plugins",
				label: "Plugins",
				hint: "Notify + Workspace plugins",
			},
			{
				value: "config",
				label: "Config",
				hint: "opencode.jsonc with MCP servers",
			},
		],
		initialValues: ["agents", "commands", "skills", "plugins", "config"],
		required: true,
	});

	if (p.isCancel(components)) {
		p.cancel("Installation cancelled.");
		process.exit(0);
	}

	const options: InstallOptions = {
		agents: components.includes("agents"),
		commands: components.includes("commands"),
		skills: components.includes("skills"),
		plugins: components.includes("plugins"),
		config: components.includes("config"),
	};

	// Plugin selection if plugins chosen
	let pluginChoices: PluginChoice = { notify: true, workspace: true };
	if (options.plugins) {
		const plugins = await p.multiselect({
			message: "Which plugins do you want?",
			options: [
				{
					value: "notify",
					label: "Notify",
					hint: "Desktop notifications, focus detection, quiet hours",
				},
				{
					value: "workspace",
					label: "Workspace",
					hint: "Plan management, notepads, verification hooks",
				},
			],
			initialValues: ["notify", "workspace"],
			required: false,
		});

		if (!p.isCancel(plugins)) {
			pluginChoices = {
				notify: plugins.includes("notify"),
				workspace: plugins.includes("workspace"),
			};
		}
	}

	// Installation
	const s = p.spinner();
	s.start("Installing op1 components...");

	let totalFiles = 0;

	try {
		// Create .opencode directory
		await fs.mkdir(opencodeDir, { recursive: true });

		// Copy agents
		if (options.agents) {
			const src = path.join(TEMPLATES_DIR, "agent");
			const dest = path.join(opencodeDir, "agent");
			if (await fileExists(src)) {
				totalFiles += await copyDir(src, dest);
			}
		}

		// Copy commands
		if (options.commands) {
			const src = path.join(TEMPLATES_DIR, "command");
			const dest = path.join(opencodeDir, "command");
			if (await fileExists(src)) {
				totalFiles += await copyDir(src, dest);
			}
		}

		// Copy skills
		if (options.skills) {
			const src = path.join(TEMPLATES_DIR, "skill");
			const dest = path.join(opencodeDir, "skill");
			if (await fileExists(src)) {
				totalFiles += await copyDir(src, dest);
			}
		}

		// Handle plugins - install from npm
		if (options.plugins && (pluginChoices.notify || pluginChoices.workspace)) {
			const pluginDir = path.join(opencodeDir, "plugin");
			await fs.mkdir(pluginDir, { recursive: true });

			// Create a simple instruction file for now
			// In production, this would install @op1/notify and @op1/workspace
			const pluginInstructions = `# op1 Plugins

To use op1 plugins, add them to your opencode.jsonc:

\`\`\`json
{
  "plugin": [
${pluginChoices.notify ? '    "@op1/notify",' : ""}
${pluginChoices.workspace ? '    "@op1/workspace"' : ""}
  ]
}
\`\`\`

Install via:
\`\`\`bash
${pluginChoices.notify ? "bun add @op1/notify" : ""}
${pluginChoices.workspace ? "bun add @op1/workspace" : ""}
\`\`\`
`;
			await fs.writeFile(path.join(pluginDir, "README.md"), pluginInstructions);
			totalFiles++;
		}

		// Copy config
		if (options.config) {
			const configSrc = path.join(TEMPLATES_DIR, "opencode.jsonc");
			const configDest = path.join(cwd, "opencode.jsonc");

			if (await fileExists(configSrc)) {
				// Check if config already exists
				if (await fileExists(configDest)) {
					const overwrite = await p.confirm({
						message: `${pc.yellow("opencode.jsonc")} already exists. Overwrite?`,
						initialValue: false,
					});

					if (!p.isCancel(overwrite) && overwrite) {
						await fs.copyFile(configSrc, configDest);
						totalFiles++;
					}
				} else {
					await fs.copyFile(configSrc, configDest);
					totalFiles++;
				}
			}
		}

		s.stop(`Installed ${totalFiles} files`);
	} catch (error) {
		s.stop("Installation failed");
		throw error;
	}

	// Summary
	p.note(
		[
			options.agents && `${pc.green("✓")} Agents installed to .opencode/agent/`,
			options.commands &&
				`${pc.green("✓")} Commands installed to .opencode/command/`,
			options.skills && `${pc.green("✓")} Skills installed to .opencode/skill/`,
			options.plugins &&
				`${pc.green("✓")} Plugin instructions at .opencode/plugin/`,
			options.config && `${pc.green("✓")} Config at opencode.jsonc`,
		]
			.filter(Boolean)
			.join("\n"),
		"Installation complete",
	);

	p.outro(`Run ${pc.cyan("opencode")} to start coding with op1!`);
}

export { copyDir, fileExists };
export type { InstallOptions, PluginChoice };
