const fs = require('fs');
const path = require('path');

const filepath = path.join(__dirname, '../apps/desktop/src/api/client.ts');
let content = fs.readFileSync(filepath, 'utf8');

const classStart = content.indexOf('export class ApiClient {');
if (classStart !== -1) {
    const mockStart = content.indexOf('let mockSubscribers');
    if (mockStart !== -1) {
        content = content.substring(0, mockStart) + '\n' + content.substring(classStart);
    }
}

function removeTryCatches(text) {
    let result = "";
    let i = 0;
    while (i < text.length) {
        if (text.substring(i).startsWith("try {")) {
            i += 4; // move past "try "
            let braceCount = 0;
            let tryContent = "";
            while (i < text.length) {
                if (text[i] === '{') {
                    if (braceCount > 0) tryContent += '{';
                    braceCount++;
                } else if (text[i] === '}') {
                    braceCount--;
                    if (braceCount === 0) {
                        i++;
                        break;
                    } else {
                        tryContent += '}';
                    }
                } else {
                    if (braceCount > 0) {
                        tryContent += text[i];
                    }
                }
                i++;
            }
            
            while (i < text.length && /\s/.test(text[i])) {
                i++;
            }
            
            if (text.substring(i).startsWith("catch")) {
                while (i < text.length && text[i] !== '{') {
                    i++;
                }
                let catchBraceCount = 0;
                while (i < text.length) {
                    if (text[i] === '{') catchBraceCount++;
                    else if (text[i] === '}') {
                        catchBraceCount--;
                        if (catchBraceCount === 0) {
                            i++;
                            break;
                        }
                    }
                    i++;
                }
                result += tryContent.trim() + "\n";
                continue;
            }
        }
        result += text[i];
        i++;
    }
    return result;
}

content = removeTryCatches(content);
fs.writeFileSync(filepath, content, 'utf8');
console.log("Done refactoring JS.");
