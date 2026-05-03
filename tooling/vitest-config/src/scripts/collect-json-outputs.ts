import fs from "fs/promises";
import path from "path";
import { glob } from "glob";

async function collectCoverageFiles() {
  try {
    const patterns = ["../../apps/*", "../../packages/*"];
    const destinationDir = path.join(process.cwd(), "coverage/raw");

    await fs.mkdir(destinationDir, { recursive: true });

    const allDirectories = [];
    const directoriesWithCoverage = [];

    for (const pattern of patterns) {
      const matches = await glob(pattern);

      for (const match of matches) {
        const stats = await fs.stat(match);

        if (stats.isDirectory()) {
          allDirectories.push(match);
          const coverageFilePath = path.join(match, "coverage.json");

          try {
            await fs.access(coverageFilePath);

            directoriesWithCoverage.push(match);

            const directoryName = path.basename(match);
            const destinationFile = path.join(
              destinationDir,
              `${directoryName}.json`
            );

            await fs.copyFile(coverageFilePath, destinationFile);
          } catch (err) {
            // coverage.json not found in this directory
          }
        }
      }
    }

    const replaceDotPatterns = (str: string) => {
      const normalized = path.normalize(str);
      const parts = normalized.split(path.sep);
      const filteredParts = parts.filter(
        (part) => part !== ".." && part !== "."
      );
      return filteredParts.join(path.sep);
    };

    if (directoriesWithCoverage.length > 0) {
      console.log(
        `Found coverage.json in: ${directoriesWithCoverage
          .map(replaceDotPatterns)
          .join(", ")}`
      );
    }

    console.log(`Coverage collected into: ${path.join(process.cwd())}`);
  } catch (error) {
    console.error("Error collecting coverage files:", error);
  }
}

collectCoverageFiles();
