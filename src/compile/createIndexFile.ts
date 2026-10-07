import { WikiConcept } from "@/types/concept";
import { writeFile } from "node:fs/promises";
import path from "node:path";

export async function createIndexFiles(concept: WikiConcept[]) {
  const data = concept?.map(item => {
    return `- **[[${item.name}]]** - ${item.summary}`
  })?.join('\n')

  const article = `
# llm-wiki

${data}

${concept?.length} pages | Generated ${new Date().toISOString()}
`
  try {
    const filePath = path.resolve(process.cwd(), "wiki/index.md");
    await writeFile(filePath, article, 'utf8')
  } catch { }
}