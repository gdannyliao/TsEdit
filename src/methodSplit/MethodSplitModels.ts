
export class Param {
    constructor(private name: string, private type: string) {
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

export class ChangedVal {
    constructor(private name: string | undefined = undefined, private type: string | undefined = undefined, private operator: string | undefined = undefined) {
    }

    getName() {
        return this.name
    }

    getOperator() {
        return this.operator
    }

    getType() {
        return this.type
    }

    setType(type: string) {
        this.type = type
    }
}

export class NewReturnVal {
    constructor(private name: string | undefined = undefined,
        private type: string | undefined = undefined, private value: string | undefined = undefined, private isPassVal: boolean = false) {
    }

    getName() {
        return this.name
    }

    getType() {
        return this.type
    }

    getValue() {
        return this.value
    }

    setValue(value: string) {
        this.value = value
    }

    /**
     * 是否是传递值。传递值，不需要创建新变量来接收。用于从子方法外部传进去的变量
     */
    isPassValue() {
        return this.isPassVal
    }

}