import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { getTenantSchema } from '../config/tenantContext.js';

const ConfiguracaoSistema = sequelize.define('ConfiguracaoSistema', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  bloquear_valor_agendamento_menor: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  },
  permitir_estoque_negativo: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  },
  permitir_cliente_duplicado: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  },
  descontar_taxa_cartao_comissao: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  },
  trabalhar_credito_cliente: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  },
  agendamento_online_ativo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false
  },
  ocultar_valores_online: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false
  },
  max_servicos_agendamento_online: {
    type: DataTypes.INTEGER,
    defaultValue: null,
    allowNull: true
  }
}, {
  tableName: 'configuracao_sistema',
  createdAt: 'criado_em',
  updatedAt: 'atualizado_em'
});

export const getConfiguracaoSistemaModel = () => {
  const tenant = getTenantSchema();
  return ConfiguracaoSistema.schema(tenant);
};

export default ConfiguracaoSistema;
