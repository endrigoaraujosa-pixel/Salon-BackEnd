import { DataTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { v4 as uuidv4 } from 'uuid';
import { getTenantSchema } from '../config/tenantContext.js';

const InventarioProtocolo = sequelize.define('InventarioProtocolo', {
  id: {
    type: DataTypes.STRING(36),
    primaryKey: true,
    defaultValue: () => uuidv4()
  },
  numero_protocolo: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  data_conferenca: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  usuario_id: {
    type: DataTypes.STRING(36),
    allowNull: false
  },
  usuario_nome: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  qtd_conferida: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  qtd_divergencias: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  valor_divergencia: {
    type: DataTypes.FLOAT,
    allowNull: false,
    defaultValue: 0
  },
  observacao: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  tableName: 'inventarios_protocolo',
  timestamps: true
});

export const getInventarioProtocoloModel = () => {
  const tenant = getTenantSchema();
  return InventarioProtocolo.schema(tenant);
};

export default InventarioProtocolo;
