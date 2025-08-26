import seedrandom from 'seedrandom';

export class RandomSeed {
    private rng: seedrandom.PRNG;
    constructor(seed: string) {
        this.rng = seedrandom(seed);
    }
    private readonly characters: string = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    getString(length: number, prefix?: string): string {
        let result: string = '';
        if (prefix !== undefined) {
            result = prefix
        }
        for (let i = 0; i < length; i++) {
            const randomIndex: number = Math.floor(this.rng() * this.characters.length);
            result += this.characters.charAt(randomIndex);
        }

        return result;
    }

    getIntInRange(min: number, max: number): number {
        return Math.floor(this.rng() * (max - min + 1)) + min;
    }
}
