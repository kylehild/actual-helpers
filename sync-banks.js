// Script to run all bank syncs
// Useful for running bank syncs on a daily/weekly schedule
const { closeBudget, openBudget } = require('./utils');
const api = require('@actual-app/api');

(async () => {
  await openBudget();

  console.log("syncing banks...");
  try {
    await api.runBankSync();
  }
  catch (error) {
    console.log(error);
  }
  
  await closeBudget();
})();
