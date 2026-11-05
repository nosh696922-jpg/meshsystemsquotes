// Refresh the Ubiquiti catalogue from the command line: npm run sync
const catalogue = require('../lib/catalogue');

catalogue
  .syncSource('ubiquiti')
  .then((data) => {
    console.log(`Done: ${data.products.length} Ubiquiti products saved.`);
    if (data.errors.length) console.log(`Some categories failed: ${data.errors.join('; ')}`);
  })
  .catch((err) => {
    console.error(`Failed: ${err.message}`);
    process.exit(1);
  });
