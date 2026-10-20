function installCheckinQueue(h) {
  h.load('shared/pendingStore.js', 'shared/outbox.js');
  if (!h.context.prepareCheckinReward) {
    h.load('checkin/reward/inventoryMigration.js', 'checkin/reward/rewardService.js', 'checkin/reward/checkinRewardFlow.js');
  }
  if (!h.context.rollReward) h.context.rollReward = () => ({ id: 'test', name: 'Test', icon: '*', type: 'shape', rarity: 'common' });
  h.load('checkin/modules/checkinQueue.js');
  h.context.checkinJobs = h.context.createCheckinQueue({ db: {}, connection: h.context.connection,
    ensureReady: () => h.context.ensureCheckinStartup(), onChange() {},
  });
  return h.context.checkinJobs;
}
module.exports = { installCheckinQueue };
