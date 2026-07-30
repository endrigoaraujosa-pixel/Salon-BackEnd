import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';
import { getTenantSchema } from '../config/tenantContext.js';

const AgendamentoOnlineSolicitacao = sequelize.define('AgendamentoOnlineSolicitacao', {
  id: {
    type: DataTypes.STRING(36),
    primaryKey: true,
    defaultValue: () => uuidv4()
  },
  cliente_id: {
    type: DataTypes.STRING(36),
    allowNull: true
  },
  nome_cliente: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  telefone: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  data_hora_desejada: {
    type: DataTypes.DATE,
    allowNull: false
  },
  servicos: {
    type: DataTypes.JSON,
    allowNull: false
  },
  profissional_id: {
    type: DataTypes.STRING(36),
    allowNull: true
  },
  observacoes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  status: {
    type: DataTypes.STRING(50),
    defaultValue: 'pendente'
  }
}, {
  tableName: 'agendamento_online_solicitacoes',
  createdAt: 'criado_em',
  updatedAt: 'atualizado_em'
});

export const getAgendamentoOnlineSolicitacaoModel = () => {
  const tenant = getTenantSchema();
  return AgendamentoOnlineSolicitacao.schema(tenant);
};

export default AgendamentoOnlineSolicitacao;
