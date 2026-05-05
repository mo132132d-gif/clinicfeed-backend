const fs = require("fs");

const file = "src/validators/entity.validators.js";
let text = fs.readFileSync(file, "utf8");

if (!text.includes("const requestTicketStatuses = [")) {
  const insertAfter = `const optionalDateTime = z.preprocess(
  (value) => (value === '' ? null : value),
  z.string().trim().min(1).nullable().optional()
);
`;

  const addBlock = `${insertAfter}
const requestTicketStatuses = [
  'new',
  'under_review',
  'waiting_customer',
  'waiting_supplier',
  'quotation_sent',
  'in_progress',
  'completed',
  'cancelled'
];

const requestTicketPriorities = ['low', 'medium', 'high', 'urgent'];
`;

  if (!text.includes(insertAfter)) {
    throw new Error("Could not find optionalDateTime block. Manual review needed.");
  }

  text = text.replace(insertAfter, addBlock);
  fs.writeFileSync(file, text, "utf8");
  console.log("Added request ticket status constants.");
} else {
  console.log("requestTicketStatuses already exists.");
}
