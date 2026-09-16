export function parseEnvValue(str: string): string[] {
    const trimmed = str.trim();
    if (!trimmed) {
        return [];
    }

    let input = trimmed;

    // Check if the entire string is wrapped in quotes
    if (
        (input.startsWith('"') && input.endsWith('"')) ||
        (input.startsWith("'") && input.endsWith("'"))
    ) {
        const quoteChar = input[0];
        let closesAtEnd = true;
        for (let i = 1; i < input.length - 1; i++) {
            if (input[i] === quoteChar) {
                closesAtEnd = false;
                break;
            }
        }
        if (closesAtEnd) {
            input = input.slice(1, -1).trim();
        }
    }

    if (!input) {
        return [];
    }

    const result: string[] = [];
    let current = "";
    let inQuotes: string | null = null;

    for (let i = 0; i < input.length; i++) {
        const char = input[i];

        if ((char === '"' || char === "'") && (inQuotes === null || inQuotes === char)) {
            inQuotes = inQuotes === null ? char : null;
            current += char;
        } else if ((char === "," || char === ";") && inQuotes === null) {
            const val = current.trim();
            if (val.length > 0) {
                result.push(val);
            }
            current = "";
        } else {
            current += char;
        }
    }

    const finalVal = current.trim();
    if (finalVal.length > 0) {
        result.push(finalVal);
    }

    return result
        .map((item) => {
            const t = item.trim();
            if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
                return t.slice(1, -1).trim();
            }
            return t;
        })
        .filter((item) => item.length > 0);
}
