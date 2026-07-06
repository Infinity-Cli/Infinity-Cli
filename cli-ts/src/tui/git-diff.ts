import { execFile } from "node:child_process";

export async function execGitDiff(filePath: string): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		execFile("git", ["diff", "--", filePath], (error, stdout) => {
			if (error) {
				reject(error);
				return;
			}
			resolve(stdout);
		});
	});
}
