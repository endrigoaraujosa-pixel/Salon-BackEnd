/** Migra um tenant por execução; não altera backups nem executa migrations de schema. */
import 'dotenv/config';
import { Op } from 'sequelize';
import { sequelize } from '../src/config/db.js';
import { tenantStorage } from '../src/config/tenantContext.js';
import { getAtendimentoFotoModel } from '../src/models/AtendimentoFoto.js';
import { getAgendamentoModel } from '../src/models/Agendamento.js';
import { migrarFotoB2 } from '../src/services/migrarFotoB2.js';

const args = process.argv.slice(2);
const schema = args[args.indexOf('--schema') + 1];
const dryRun = args.includes('--dry-run');
if (!args.includes('--schema') || !/^(company_[a-zA-Z0-9_]+|public)$/.test(schema || '')) {
  console.error('Informe --schema company_nome [--dry-run].');
  process.exitCode = 1;
} else {
  try {
    await sequelize.authenticate();
    await tenantStorage.run(schema, async () => {
      const Model = getAtendimentoFotoModel();
      let cursor = '', total = 0, failures = 0, bytes = 0;
      while (true) {
        // Apenas uma foto por vez na memória, inclusive para bases grandes.
        const candidate = await Model.findOne({
          attributes: ['id', 'agendamento_id'],
          where: { id: { [Op.gt]: cursor }, [Op.or]: [
            { imagem: { [Op.ne]: null } }, { miniatura: { [Op.ne]: null } }
          ] }, order: [['id', 'ASC']]
        });
        if (!candidate) break;
        cursor = candidate.id;
        if (dryRun) { total++; continue; }
        try {
          bytes += await sequelize.transaction(async transaction => {
            // Mesma ordem de locks usada nos envios e remoções da API.
            await getAgendamentoModel().findByPk(candidate.agendamento_id, { transaction, lock: transaction.LOCK.UPDATE });
            const foto = await Model.unscoped().findByPk(candidate.id, { transaction, lock: transaction.LOCK.UPDATE });
            if (!foto) return 0;
            return migrarFotoB2(foto, transaction);
          });
          total++;
        } catch (error) {
          failures++;
          console.error('Falha na foto', candidate.id, error.message);
        }
      }
      console.log({ schema, dryRun, fotos: total, falhas: failures, bytesRetiradosDoBanco: bytes });
      if (failures) process.exitCode = 1;
    });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { await sequelize.close(); }
}
