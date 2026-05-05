const fs = require("fs");

const file = "src/validators/entity.validators.js";
let text = fs.readFileSync(file, "utf8");

if (!text.includes("const requestTicketStatuses")) {
  const marker = "const requestTicketCreate = z.object({";

  const block = `const requestTicketStatuses = [
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

  if (!text.includes(marker)) {
    throw new Error("requestTicketCreate not found");
  }

  text = text.replace(marker, block + marker);
  fs.writeFileSync(file, text, "utf8");
  console.log("Fixed: requestTicketStatuses added before requestTicketCreate");
} else {
  console.log("requestTicketStatuses already exists");
}
