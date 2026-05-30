const fs = require('fs');

// 1. Update FVGStrategy.js
const fvgPath = '/Users/maheendran/Desktop/Project 12/personal/billion/billion-bot-backend/strategies/FVGStrategy.js';
let fvgCode = fs.readFileSync(fvgPath, 'utf8');

// Add status: "waiting"
fvgCode = fvgCode.replace(/filled: false,/g, 'filled: false,\n                            status: "waiting",');

// Add status: "cancelled" to superseded FVGs
fvgCode = fvgCode.replace(/oldFvg\.filledAt = c3\.time;/g, 'oldFvg.filledAt = c3.time;\n                            oldFvg.status = "cancelled";');

// Add status: "skipped" for simulationStart
fvgCode = fvgCode.replace(/if \(curr\.time < simulationStart\) \{\n                            fvg\.filled = true;\n                            fvg\.filledAt = curr\.time;/g, 'if (curr.time < simulationStart) {\n                            fvg.filled = true;\n                            fvg.filledAt = curr.time;\n                            fvg.status = "skipped";');

// Add status: "skipped" for riskPerUnit limits
fvgCode = fvgCode.replace(/if \(riskPerUnit < minRiskPerUnit \|\| riskPerUnit > maxRiskPerUnit\) \{\n                            fvg\.filled = true;\n                            fvg\.filledAt = curr\.time;/g, 'if (riskPerUnit < minRiskPerUnit || riskPerUnit > maxRiskPerUnit) {\n                            fvg.filled = true;\n                            fvg.filledAt = curr.time;\n                            fvg.status = "skipped";');

// Add status: "skipped" for minQty limits
fvgCode = fvgCode.replace(/if \(units < minQty \|\| units <= 0\) \{\n                            fvg\.filled = true;\n                            fvg\.filledAt = curr\.time;/g, 'if (units < minQty || units <= 0) {\n                            fvg.filled = true;\n                            fvg.filledAt = curr.time;\n                            fvg.status = "skipped";');

// Add status: "trade_executed" at the end of the block (before activeFVGs.splice)
fvgCode = fvgCode.replace(/fvg\.filled = true;\n                        fvg\.filledAt = curr\.time;\n                        activeFVGs\.splice/g, 'fvg.filled = true;\n                        fvg.filledAt = curr.time;\n                        fvg.status = "trade_executed";\n                        activeFVGs.splice');

fs.writeFileSync(fvgPath, fvgCode);

// 2. Update Backtest.jsx
const backtestPath = '/Users/maheendran/Desktop/Project 12/personal/billion/billion-bot-frontend/src/pages/Backtest.jsx';
let btCode = fs.readFileSync(backtestPath, 'utf8');

btCode = btCode.replace(/\{fvg\.filled \? 'CANCELLED \/ TRADED' : 'ACTIVELY WAITING'\}/g, "{fvg.status === 'trade_executed' ? 'TRADE EXECUTED' : fvg.status === 'cancelled' ? 'CANCELLED' : fvg.status === 'skipped' ? 'SKIPPED (RISK LIMIT)' : 'ACTIVELY WAITING'}");

fs.writeFileSync(backtestPath, btCode);
console.log('Done');
