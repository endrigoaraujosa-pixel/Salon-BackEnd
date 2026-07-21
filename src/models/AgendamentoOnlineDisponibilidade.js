import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';
import { getTenantSchema } from '../config/tenantContext.js';

const AgendamentoOnlineDisponibilidade = sequelize.define('AgendamentoOnlineDisponibilidade', {
  id: {
    type: DataTypes.STRING(36),
    primaryKey: true,
    defaultValue: () => uuidv4()
  },
  dia_semana: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  hora_inicio: {
    type: DataTypes.STRING(5),
    allowNull: false
  },
  hora_fim: {
    type: DataTypes.STRING(5),
    allowNull: false
  },
  ativo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  tableName: 'agendamento_online_disponibilidade',
  createdAt: 'criado_em',
  updatedAt: 'atualizado_em'
});

export const getAgendamentoOnlineDisponibilidadeModel = () => {
  const tenant = getTenantSchema();
  return AgendamentoOnlineDisponibilidade.schema(tenant);
};

export default AgendamentoOnlineDisponibilidade;
