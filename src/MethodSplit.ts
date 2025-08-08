import { Block, Node, Project, ParameterDeclaration, Type, SyntaxKind, Statement, ClassDeclaration, MethodDeclaration, VariableDeclaration, ParameterDeclarationStructure, StructureKind, StatementStructures, SourceFile } from "ts-morph"
import seedrandom from 'seedrandom';
import { RandStr } from "./RandStr.ts";
import { existsSync, mkdirSync } from "node:fs";

class Param {
    constructor(private name: string, private type: Type) {
    }

    getName() {
        return this.name
    }

    getType() {
        return this.type
    }

    setName(name: string) {
        this.name = name
    }

}

declare module "ts-morph" {
    interface ParameterDeclaration {
        toParam(): Param
    }
}
ParameterDeclaration.prototype.toParam = function () {
    return new Param(this.getName(), this.getType())
}

export class MethodSplit {
    private randNum: seedrandom.PRNG;
    private randStr: RandStr
    private currentCls: ClassDeclaration | undefined
    private currentMethod: MethodDeclaration | undefined
    private changedFiles: Set<SourceFile> = new Set()

    constructor(private project: Project, private seed: string) {
        this.randNum = seedrandom(seed);
        this.randStr = new RandStr(seed)
    }
    private getRandomInt(min: number, max: number) {
        return Math.floor(this.randNum() * (max - min + 1)) + min;
    }

    private shouldSplit(block: Block) {
        return block.getStatements().length > 3
    }
    private getSplitRange(block: Block, start: number = 0): [number, number, Set<VariableDeclaration>] {
        const newVars = new Set<VariableDeclaration>()
        const end = this.getRandomInt(start, block.getStatements().length)
        for (let i = start; i < end; i++) {
            if (block.getStatements()[i].getKind() === SyntaxKind.VariableStatement) {
                const varStmt = block.getStatements()[i].asKind(SyntaxKind.VariableStatement)!
                varStmt.getDeclarations().forEach(decl => {
                    newVars.add(decl)
                })
                start = i + 1
            }
        }
        return [start, end, newVars]
    }

    private toTypeText(type: Type): string {
        if (type.isLiteral()) {
            return type.getBaseTypeOfLiteralType().getText()
        }
        return type.getText()
    }
    private insertNewMethod(statements: Statement[], newVars: Set<VariableDeclaration>): MethodDeclaration | undefined {
        if (!this.currentCls || !this.currentMethod) {
            return undefined
        }
        const newParams: ParameterDeclarationStructure[] = []
        const params = this.currentMethod.getParameters()
        params.forEach(param => {
            newParams.push(param.getStructure())
        })
        newVars.forEach(varDecl => {
            newParams.push({
                kind: StructureKind.Parameter,
                name: varDecl.getName(),
                type: this.toTypeText(varDecl.getType()),
            })
        })

        const lastStatement = statements[statements.length - 1]
        if (lastStatement.getKind() === SyntaxKind.ReturnStatement) {
            const returnStmt = lastStatement.asKind(SyntaxKind.ReturnStatement)!
            const returnType = returnStmt.getExpression()?.getType()
            return this.currentCls.addMethod({
                name: `z_${this.randStr.getString(10)}`,
                parameters: newParams,
                statements: statements.map(statement => statement.getText()),
                returnType: returnType? this.toTypeText(returnType) : undefined,
            })
        }

        return this.currentCls.addMethod({
            name: `z_${this.randStr.getString(10)}`,
            parameters: newParams,
            statements: statements.map(statement => statement.getText()),
        })

    }
    private splitBlock(block: Block) {
        if (!this.shouldSplit(block)) {
            return
        }

        const [start, end, newVars] = this.getSplitRange(block)

        const extractStatements = block.getStatements().slice(start, end)
        const newMethod = this.insertNewMethod(extractStatements, newVars)
        if (!newMethod) {
            return
        }
        block.removeStatements([start, end - 1])
        //向Block中添加调用新方法的语句
        if (newMethod.getReturnType()) {
            block.insertStatements(start, [`return this.${newMethod.getName()}(${newMethod.getParameters().map(param => param.getName()).join(',')})`])
        } else {
            block.insertStatements(start, [`this.${newMethod.getName()}(${newMethod.getParameters().map(param => param.getName()).join(',')})`])
        }
    }

    split(clsName: string, methodName: string) {
        this.project.getSourceFiles().some(file => {
            if (file.getFilePath().endsWith(".d.ts")) {
                return false
            }
            const classDecl = file.getClass(clsName)
            if (!classDecl) {
                return false
            }
            const method = classDecl.getMethod(methodName)
            if (!method) {
                return false
            }

            this.currentCls = classDecl
            this.currentMethod = method
            /*如何拆分方法？
            -收集方法参数，存入栈中
            -进行逐行扫描
                -遇到块，则递归
                -遇到let/const，存入栈中
            */
            const body = method.getBody()
            if (Node.isBlock(body)) {
                // const params = method.getParameters().reduce((map, param) => {
                //     const p = param.toParam()
                //     map.set(p.getName(), p)
                //     return map
                // }, new Map<string, Param>())

                this.splitBlock(body)
            }

            this.changedFiles.add(file)
            return true
        })
    }

    saveSync(outputDir?: string) {
        for (const file of this.changedFiles) {
            if (outputDir) {
                if (!existsSync(outputDir)) {
                    mkdirSync(outputDir, { recursive: true })
                }
                file.moveToDirectory(outputDir)
            }
            file.saveSync()
        }
    }

}