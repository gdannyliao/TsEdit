export class ImportedThing {
    value: number = 1
}

export function makeThing(): ImportedThing {
    return new ImportedThing()
}
