const mongoose = require('mongoose');
const { AdvisorError } = require('./errors');

const schema = new mongoose.Schema({
  leagueName: { type: String, required: true, unique: true },
  leagueId: { type: String, required: true },
  seasonId: { type: Number, required: true },
  sport: { type: String, required: true },
  updatedAt: { type: Date, required: true },
  data: { type: mongoose.Schema.Types.Mixed, required: true }
});
const AdvisorSnapshot = mongoose.models.AdvisorSnapshot || mongoose.model('AdvisorSnapshot', schema);

async function saveSnapshot(snapshot) {
  const { teams, players, playerPoolComplete } = snapshot.data;
  if (!playerPoolComplete || !teams?.length || !players?.length
    || new Set(players.map(p => p.id)).size !== players.length) {
    throw new AdvisorError('INCOMPLETE_ADVISOR_DATA', 'The ESPN dataset was incomplete. The previous advisor data was preserved.', 502);
  }
  const document = new AdvisorSnapshot(snapshot);
  await document.validate();
  const data = document.toObject();
  delete data._id;
  return AdvisorSnapshot.findOneAndUpdate({ leagueName: snapshot.leagueName }, { $set: data }, { upsert: true, new: true, runValidators: true });
}
module.exports = { AdvisorSnapshot, saveSnapshot };
