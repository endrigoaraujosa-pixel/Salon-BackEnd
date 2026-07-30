import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';
import { getTenantSchema } from '../config/tenantContext.js';

const ColaboradorComissaoServico = sequelize.define('ColaboradorComissaoServico', {
  id: {
    type: DataTypes.STRING(36),
    primaryKey: true,
    defaultValue: () => uuidv4()
  },
  colaborador_id: {
    type: DataTypes.STRING(36),
    allowNull: false
  },
  servico_id: {
    type: DataTypes.STRING(36),
    allowNull: false
  },
  comissao_principal: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 40
  },
  comissao_sozinho: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 40
  },
  comissao_ajuda: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 30
  },
  comissao_auxiliar: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 20
  },
  agendamento_online_ativo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false
  },
  criado_em: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'colaborador_comissao_servico',
  timestamps: false
});

export const getColaboradorComissaoServicoModel = () => {
  const tenant = getTenantSchema();
  return ColaboradorComissaoServico.schema(tenant);
};

export default ColaboradorComissaoServico;
