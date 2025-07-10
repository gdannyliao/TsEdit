import { Project, SyntaxKind } from "ts-morph";
import path from "path";
import { TsRename } from "./TsRename";
import { RandStr } from "./RandStr";
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

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
  .check((argv) => {
    if (!argv['name-map'] && !argv['random']) {
      throw new Error("请指定名称映射文件或指定随机重命名")
    }
    return true
  })
  .parse()

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


const project = new Project({tsConfigFilePath: path.join(args['project'], "tsconfig.json")});
project.resolveSourceFileDependencies();

const nameMap = new Map<string, Map<string, CodeName>>()
if (args['random']) {
  const random = new RandStr(args['project'])
  project.getSourceFiles().forEach(file => {
    if (file.getFilePath().endsWith(".d.ts")) {
      return
    }
    file.getClasses().forEach(classDecl => {
      const className = classDecl.getName()
      if (className === undefined) {
        return
      }
      const classMap = new Map<string, CodeName>()
      classMap.set(className, new CodeName(random.getString(6, "C_"), CodeType.Class))
      nameMap.set(className, classMap);

      classDecl.getProperties().forEach(property => {
        const propertyName = property.getName()
        if (propertyName === undefined) {
          return
        }
        classMap.set(propertyName, new CodeName(random.getString(6, "p_"), CodeType.Property))
      })

      classDecl.getMethods().forEach(method => {
        const methodName = method.getName()
        if (methodName === undefined) {
          return
        }
        classMap.set(methodName, new CodeName(random.getString(6, "m_"), CodeType.Method))
      })
    })
  })

}

const renamer = new TsRename(project)

nameMap.forEach((classMap, className) => {
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