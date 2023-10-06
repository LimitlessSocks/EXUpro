const fs = require("fs");
const LuaParser = require("luaparse");

const assert = (expr, ifError = "<no reason provided>") => {
    if(!expr) {
        // TODO: use real error subclass
        throw new Error(`Assertion Error: ${ifError}`);
    }
};

const words = (templates, ...values) => {
    assert(values.length === 0, "Cannot handle interpolated values in words yet");
    return templates.join("")
        .trim()
        .split(/\s+/);
};

// performs static analysis on lua code for things like using undefined variables
class LuaFileVerifier {
    constructor(code, quiet = true) {
        this.code = code;
        this.quiet = quiet;
        // this.defineds and this.useds are indexed by scope number
        // the head (scope number 0) is "global"
        this.defineds = [ new Map() ];
        this.useds = [ new Map() ];
        // TODO: catch parse error
        this.ast = LuaParser.parse(content);
        this.warnings = [];
        this.initializeGlobalScope();
    }
    
    static GLOBAL_IDENTIFIERS = words`
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
        c:RegisterEffect e:GetHandler g:GetFirst tc:GetTextAttack
    `;
    // TODO: rectify hack for parameters. right now, they depend on convention
    // (e.g., c inherently means something)
    initializeGlobalScope() {
        for(let gid of LuaFileVerifier.GLOBAL_IDENTIFIERS) {
            this.addDefine(gid, 0, false);
        }
    }
    
    warn(message) {
        this.warnings.push(message);
    }
    
    log(...args) {
        if(this.quiet) return;
        console.log(...args);
    }
    
    showWarnings() {
        this.warnings.forEach((warning, idx) => {
            console.warn(`Warning #${idx + 1}:`, warning);
        });
        if(!this.warnings.length) {
            console.log("No fatal warnings!");
        }
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
        this.log("Starting new local scope");
        this.defineds.push(new Map());
        this.useds.push(new Map());
    }
    
    removeLocalScope() {
        assert(this.defineds.length > 1, "Cannot remove top scope");
        this.log("Removing old local scope");
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
    
    addDeclare(name, localDepth, isLocal) {
        if(!isLocal) {
            localDepth = 0;
        }
        this.assertHasScopeDepth(localDepth);
        // TODO: check only localDepth scope?
        if(this.isDefined(name, localDepth)) {
            this.warn({
                type: "VariableRedefinition",
                name
            });
        }
        else {
            // clear warnings. this might not work in all cases.
            this.warnings = this.warnings.filter(warning =>
                !(warning.type === "UseUndefined" && warning.name === name)
            );
        }
    }
    
    addDefine(name, localDepth, isLocal) {
        if(!isLocal) {
            localDepth = 0;
        }
        this.assertHasScopeDepth(localDepth);
        this.log("Defining:", name, "@", localDepth);
        this.defineds[localDepth].set(name, true);
    }
    
    static DERIVED_PROPERTIES = new Map([
        ["Effect.CreateEffect", words`
            Clone
            SetCategory
            SetCode
            SetCost
            SetCountLimit
            SetDescription
            SetOperation
            SetProperty
            SetRange
            SetReset
            SetTarget
            SetType
            SetValue
        `],
    ]);
    addDerivedDefine(name, derivedIdent, localDepth, isLocal) {
        if(!isLocal) {
            localDepth = 0;
        }
        this.assertHasScopeDepth(localDepth);
        if(derivedIdent.endsWith(":Clone")) {
            let scope = this.defineds[localDepth];
            let cloneTarget = derivedIdent.slice(0, -5); // include the colon
            for(let key of scope.keys()) {
                if(key.startsWith(cloneTarget)) {
                    let property = key.slice(cloneTarget.length);
                    this.addDefine(`${name}:${property}`, localDepth, isLocal);
                }
            }
        }
        
        let props = LuaFileVerifier.DERIVED_PROPERTIES.get(derivedIdent);
        // assert(props, `No defined derive`);
        if(!props) {
            console.warn(`No derived properties found for ${derivedIdent}`);
            return;
        }
        for(let prop of props) {
            this.addDefine(`${name}:${prop}`, localDepth, isLocal);
        }
    }
    
    addUse(name, localDepth) {
        this.assertHasScopeDepth(localDepth);
        if(!this.isDefined(name, localDepth)) {
            this.warn({
                type: "UseUndefined",
                name
            });
        }
        this.log("Using:", name, "@", localDepth);
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
                // this.log("Arg", arg);
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
            this.log(`[[ STATEMENT ${type} ]]`);
            if(type === "LocalStatement") {
                this.log(statement);
                let derivedIdent = null;
                if(statement.init[0].type === "CallExpression") {
                    derivedIdent = this.getIdentifierName(statement.init[0].base);
                }
                // definition location
                for(let varObject of statement.variables) {
                    let varName = this.getIdentifierName(varObject);
                    this.addDeclare(varName, localDepth, true);
                    this.addDefine(varName, localDepth, true);
                    if(derivedIdent) {
                        this.addDerivedDefine(varName, derivedIdent, localDepth, true);
                    }
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
                this.log(statement);
                // definition location
                let funcName = this.getIdentifierName(statement.identifier);
                this.addDeclare(funcName, localDepth, statement.isLocal);
                this.addDefine(funcName, localDepth, statement.isLocal);
                this.addLocalScope();
                this.log("Defining local parameters...");
                for(let param of statement.parameters) {
                    let paramName = this.getIdentifierName(param);
                    this.addDefine(paramName, localDepth + 1, true);
                }
                this.traverse(statement, depth + 1, localDepth + 1);
                this.removeLocalScope();
            }
            else if(type === "CallStatement") {
                this.log(statement);
                this.checkExpression(statement.expression, localDepth);
            }
            else if(type === "IfStatement") {
                // includes all branches
                for(let branch of statement.clauses) {
                    this.log(branch);
                    if(branch.condition) {
                        this.checkExpression(branch.condition, localDepth)
                    }
                    this.traverse(branch, depth + 1, localDepth);
                }
            }
            else if(type === "ReturnStatement") {
                for(let arg of statement.arguments) {
                    this.log("Arg in return", arg);
                    this.checkExpression(arg, localDepth);
                }
            }
            else {
                this.log("unhandled type:", type);
                this.log(statement);
                process.exit(1);
            }
            
            
            this.log("-".repeat(30));
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
