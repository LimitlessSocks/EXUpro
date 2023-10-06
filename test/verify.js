const fs = require("fs");
const LuaParser = require("luaparse");

const assert = (expr, ifError = "<no reason provided>") => {
    if(!expr) {
        // TODO: use real error subclass
        throw new Error(`Assertion Error: ${ifError}`);
    }
};

// performs static analysis on lua code for things like using undefined variables
class LuaFileVerifier {
    constructor(code) {
        this.code = code;
        // this.defineds and this.useds are indexed by scope number
        // the head (scope number 0) is "global"
        this.defineds = [ new Map() ];
        this.useds = [ new Map() ];
        // TODO: catch parse error
        this.ast = LuaParser.parse(content);
        this.warnings = [];
        this.initializeGlobalScope();
    }
    
    static GLOBAL_IDENTIFIERS = `
        REASON_COST REASON_EFFECT 
        CATEGORY_DAMAGE
        EFFECT_FLAG_PLAYER_TARGET EFFECT_FLAG_SINGLE_RANGE
        EFFECT_TYPE_IGNITION EFFECT_TYPE_SINGLE
        LOCATION_MZONE
        HINT_SELECTMSG HINTMSG_FACEUP
        RESET_EVENT
        EFFECT_UPDATE_ATTACK EFFECT_UPDATE_DEFENSE
        aux.Stringid aux.AddKaijuProcedure
        Duel.IsCanRemoveCounter Duel.RemoveCounter Duel.Damage Duel.Hint Duel.GetMatchingGroup
        Effect.CreateEffect
        GetID
    `.trim().split(/\s+/);
    initializeGlobalScope() {
        for(let gid of LuaFileVerifier.GLOBAL_IDENTIFIERS) {
            this.addDefine(gid, 0, false);
        }
    }
    
    warn(...message) {
        this.warnings.push(message);
    }
    
    showWarnings() {
        this.warnings.forEach((warning, idx) => {
            console.warn(`Warning #${idx + 1}:`, ...warning);
        });
    }
    
    getIdentifierName(ident) {
        if(ident.type === "Identifier") {
            return ident.name;
        }
        else if(ident.type === "MemberExpression") {
            assert(ident.indexer === "." || ident.indexer === ":",
                `Cannot parse member expression ${ident.indexer}`);
            return (
                this.getIdentifierName(ident.base)
                + ident.indexer
                + this.getIdentifierName(ident.identifier)
            );
        }
        
        assert(null, `Cannot parse type ${ident.type} for getIdentifierName`);
    }
    
    addLocalScope() {
        console.log("Starting new local scope");
        this.defineds.push(new Map());
        this.useds.push(new Map());
    }
    
    removeLocalScope() {
        assert(this.defineds.length > 1, "Cannot remove top scope");
        console.log("Removing old local scope");
        this.defineds.pop();
        this.useds.pop();
    }
    
    isDefined(name, localDepth) {
        let candidates = this.defineds.slice(0, localDepth + 1);
        return candidates.find(scope => scope.has(name));
    }
    
    assertHasScopeDepth(localDepth) {
        assert(typeof localDepth === "number",
            `Cannot handle non-numeric localDepth type ${typeof localDepth}`);
        assert(localDepth < this.defineds.length,
            `Depth index ${localDepth} not explicitly supported by program, current supported depth is ${this.defineds.length - 1}`);
        assert(this.defineds.length === this.useds.length,
            `Defineds length ${this.defineds.length} out of sync with useds length ${this.useds.length}`);
    }
    
    addDefine(name, localDepth, isLocal) {
        if(!isLocal) {
            localDepth = 0;
        }
        this.assertHasScopeDepth(localDepth);
        if(this.isDefined(name, localDepth)) {
            // is this even necessary? probably not
            // this.warn(`Variable redefinition of ${name}`);
        }
        console.log("Defining:", name, "@", localDepth);
        this.defineds[localDepth].set(name, true);
    }
    
    addUse(name, localDepth) {
        this.assertHasScopeDepth(localDepth);
        if(!this.isDefined(name, localDepth)) {
            this.warn(`Using undefined variable ${name}`);
        }
        console.log("Using:", name, "@", localDepth);
        this.useds[localDepth].set(name, true);
    }
    
    isExpression(object) {
        // TODO: there has to be something better.
        // TODO: account for unary expression?
        return !!object.left;
    }
    
    static LITERAL_EXPRESSIONS = [
        "NumericLiteral",
        "BooleanLiteral",
        "NilLiteral"
    ];
    static BINARY_EXPRESSIONS = [
        "BinaryExpression",
        "LogicalExpression"
    ];
    checkExpression(expression, localDepth) {
        assert(typeof expression == "object",
            `Cannot check expression of non-object type ${typeof expression}`);
        
        try {
            let name = this.getIdentifierName(expression);
            this.addUse(name, localDepth);
            return true;
        }
        catch {
            // pass: invalid identifier
        }
        
        if(expression.type === "CallExpression") {
            let baseName = this.getIdentifierName(expression.base);
            this.addUse(baseName, localDepth);
            for(let arg of expression.arguments) {
                console.log("Arg", arg);
                this.checkExpression(arg, localDepth);
            }
        }
        else if(LuaFileVerifier.LITERAL_EXPRESSIONS.includes(expression.type)) {
            // ignore
        }
        else if(LuaFileVerifier.BINARY_EXPRESSIONS.includes(expression.type)) {
            try {
                let leftName = this.getIdentifierName(expression.left);
                this.addUse(leftName, localDepth);
            }
            catch {
                // TODO: catch only assert error
                if(this.isExpression(expression.left)) {
                    this.checkExpression(expression.left, localDepth);
                }
            }
            try {
                let rightName = this.getIdentifierName(expression.right);
                this.addUse(leftName, localDepth);
            }
            catch {
                // TODO: catch only assert error
                if(this.isExpression(expression.right)) {
                    this.checkExpression(expression.right, localDepth);
                }
            }
        }
        else {
            console.log("== Problem expression == ", expression);
            assert(null, `No case defined in checkExpression for ${expression.type}`);
        }
    }
    
    // depth is number of trees descended, localDepth is number of scopes descended
    traverse(ast = this.ast, depth = 0, localDepth = 0) {
        if(depth > 0) {
            console.group();
        }
        for(let statement of ast.body) {
            let { type } = statement;
            console.log(`[[ STATEMENT ${type} ]]`);
            if(type === "LocalStatement") {
                console.log(statement);
                // definition location
                for(let varObject of statement.variables) {
                    let varName = this.getIdentifierName(varObject);
                    this.addDefine(varName, localDepth, true);
                    // TODO: derived properties based on the expression
                }
                for(let arg of statement.init) {
                    this.checkExpression(arg, localDepth);
                }
            }
            else if(type === "AssignmentStatement") {
                for(let varObject of statement.variables) {
                    let varName = this.getIdentifierName(varObject);
                    // TODO: is this supposed to be local? i'm guessing not, but i'll mark it as such
                    // TODO: is this even a define? do lua variables need to be declared first?
                    this.addDefine(varName, localDepth, true);
                }
            }
            else if(type === "FunctionDeclaration") {
                console.log(statement);
                // definition location
                let funcName = this.getIdentifierName(statement.identifier);
                this.addDefine(funcName, localDepth, statement.isLocal);
                this.addLocalScope();
                console.log("Defining local parameters...");
                for(let param of statement.parameters) {
                    let paramName = this.getIdentifierName(param);
                    this.addDefine(paramName, localDepth + 1, true);
                }
                this.traverse(statement, depth + 1, localDepth + 1);
                this.removeLocalScope();
            }
            else if(type === "CallStatement") {
                console.log(statement);
                this.checkExpression(statement.expression, localDepth);
            }
            else if(type === "IfStatement") {
                // includes all branches
                for(let branch of statement.clauses) {
                    console.log(branch);
                    if(branch.condition) {
                        this.checkExpression(branch.condition, localDepth)
                    }
                    this.traverse(branch, depth + 1, localDepth);
                }
            }
            else if(type === "ReturnStatement") {
                for(let arg of statement.arguments) {
                    console.log("Arg in return", arg);
                    this.checkExpression(arg, localDepth);
                }
            }
            else {
                console.log("unhandled type:", type);
                console.log(statement);
                process.exit(1);
            }
            
            
            console.log("-".repeat(30));
        }
        if(depth > 0) {
            console.groupEnd();
        }
    }
}



let filePath = "./../script/c1281323.lua";
let content = fs.readFileSync(filePath).toString();
// console.log(content);

let verifier = new LuaFileVerifier(content);
verifier.traverse();
console.log("=".repeat(70));
verifier.showWarnings();
