import { Project } from "ts-morph";
import path from "node:path";
import { RandStr } from "./RandStr.ts";
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { CocosInvokeGraph } from "./CocosInvokeGraph.ts";
import { existsSync, fstat, readFileSync } from "node:fs";
import { TsRenameBuilder } from "./TsRenameBuilder.ts";
import process from "node:process";
import * as fs from 'node:fs/promises';

const args = yargs(hideBin(process.argv)).scriptName("ts-rename")
  .option('project', {
    type: 'string', description: '要处理的ts项目路径', require: true, alias: 'p'
  })
  .option('name-map', {
    type: 'string', description: '名称映射关系文件路径', alias: 'n'
  })
  .option('random', {
    type: 'boolean', description: '是否随机重命名', alias: 'r'
  })
  .option('keep', {
    type: 'string', description: '要保留的符号名，以类全名为首行，后跟-PROPERTY_NAME作为此类的属性名', alias: 'k'
  })
  .check((argv) => {
    if (!argv['name-map'] && !argv['random']) {
      throw new Error("请指定名称映射文件或指定随机重命名")
    }
    return true
  })
  .parseSync()

enum CodeType {
  Class,
  Property,
  Method,
}

class CodeName {
  constructor(
    public name: string,
    public type: CodeType,
  ) {
  }
}

function isCocosProject(projectDir: string): boolean {
  const projectJsonFile = path.join(projectDir, "project.json")
  if (!existsSync(projectJsonFile)) {
    return false
  }

  const projectJson = JSON.parse(readFileSync(projectJsonFile, "utf-8"))
  if ('engine' in projectJson && projectJson['engine'].includes('cocos')) {
    return true
  }
  return true
}

async function parseFileToMap(filePath: string): Promise<Map<string, Set<string>>> {
  const data = await fs.readFile(filePath, 'utf-8');
  const lines = data
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  const result = new Map<string, Set<string>>();
  let className: string | null = null;

  for (const line of lines) {
    if (line.startsWith('-')) {
      const propertyName = line.substring(1); // 去掉 `-`
      result.get(className!)!.add(propertyName);
    } else {
      className = line;
      result.set(className, new Set());
    }
  }

  return result;
}

if (!isCocosProject(args.project)) {
  console.error("不是cocos项目")
  process.exit(1)
}


const renameBuilder = new TsRenameBuilder().setProjectDir(args.project).setInvokeGraph(CocosInvokeGraph)
let keepMap: Map<string, Set<string>> | undefined
if (args['keep']) {
  const file = args['keep']
  if (!existsSync(file)) {
    console.error(`文件${file}不存在`)
  }
  keepMap = await parseFileToMap(file)
}

const project = new Project({ tsConfigFilePath: path.join(args['project'], "tsconfig.json") });
project.resolveSourceFileDependencies();

const renameMap = new Map<string, Map<string, CodeName>>()
if (args['random']) {
  const random = new RandStr(args['project'])
  project.getSourceFiles().forEach(file => {
    if (file.getFilePath().endsWith(".d.ts")) {
      console.warn(`忽略d.ts文件: ${file.getFilePath()}`)
      return
    }
    file.getClasses().forEach(classDecl => {
      const className = classDecl.getName()
      if (className === undefined) {
        return
      }

      const keepSet = keepMap?.get(className)

      if (keepSet !== undefined && keepSet.size === 0) {
        console.warn(`保留类${className}`) //如果没有指定哪些属性要保留，则保留整个类所有的属性和类名
        return
      }

      const classMap = new Map<string, CodeName>()
      renameMap.set(className, classMap);

      classDecl.getProperties().forEach(property => {
        const propertyName = property.getName()
        if (propertyName === undefined) {
          return
        }
        if (keepSet?.has(propertyName)) {
          console.warn(`保留类${className}的属性${propertyName}`)
          return
        }
        classMap.set(propertyName, new CodeName(random.getString(6, "p_"), CodeType.Property))
      })

      classDecl.getMethods().forEach(method => {
        const methodName = method.getName()
        if (methodName === undefined) {
          return
        }
        if (keepSet?.has(methodName)) {
          console.warn(`保留类${className}的方法${methodName}`)
          return
        }
        classMap.set(methodName, new CodeName(random.getString(6, "m_"), CodeType.Method))
      })
      classMap.set(className, new CodeName(random.getString(6, "C_"), CodeType.Class))
    })
  })

}

const renamer = renameBuilder.build()
renameMap.forEach((classMap, className) => {
  classMap.forEach((code, oldName) => {
    switch (code.type) {
      case CodeType.Class:
        renamer.setClassName(className, code.name)
        className = code.name
        break;
      case CodeType.Property:
        renamer.setPropertyName(className, oldName, code.name)
        break;
      case CodeType.Method:
        renamer.setMethodName(className, oldName, code.name)
        break;
    }
  })
})
renamer.save()
console.log("rename success")