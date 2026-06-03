import { db } from "../config/db.js";
const getTodayDateString = () => {
  return new Date().toLocaleDateString('en-CA');
};

const listReceitas = async (req, res) => {
  try {
    const receitas = await db.OutrasReceitas.findAll({
      where: { deletado: 'N' },
      order: [['data_vencimento', 'DESC']]
    });
    
    const today = getTodayDateString();
    
    // Dynamically calculate "Vencido" status for overdue, unpaid, non-cancelled receipts
    const updatedReceitas = receitas.map(r => {
      const plain = r.get({ plain: true });
      if (plain.status === 'Aberto' && !plain.recebido && plain.data_vencimento && plain.data_vencimento < today) {
        plain.status = 'Vencido';
      }
      return plain;
    });
    
    res.json(updatedReceitas);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const createReceita = async (req, res) => {
  try {
    if (req.body.valor !== undefined) {
      const valorStr = String(req.body.valor).replace(",", ".");
      req.body.valor = parseFloat(valorStr) || 0;
    }
    if (!req.body.descricao || !String(req.body.descricao).trim()) {
      return res.status(400).json({ detail: 'Descrição é obrigatória' });
    }
    
    // Set default status based on payment field
    if (req.body.recebido === true || req.body.status === 'Recebido') {
      req.body.recebido = true;
      req.body.status = 'Recebido';
      req.body.baixado_por = req.user ? req.user.name : 'Sistema';
      req.body.baixado_em = new Date();
      if (!req.body.data_recebimento) {
        req.body.data_recebimento = getTodayDateString();
      }
    } else {
      if (!req.body.status) {
        req.body.status = 'Aberto';
      }
      req.body.recebido = false;
    }

    const receita = await db.OutrasReceitas.create(req.body);
    res.status(201).json(receita);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const updateReceita = async (req, res) => {
  try {
    const receita = await db.OutrasReceitas.findByPk(req.params.id);
    if (!receita) return res.status(404).json({ detail: 'Receita não encontrada' });
    
    // Security restriction: Restrict editing of already received receipts
    // Allow updating if they are explicitly undoing the write-off (setting recebido to false or status to Aberto)
    const wasReceived = receita.recebido || receita.status === 'Recebido';
    const isUndoingWriteOff = req.body.recebido === false || req.body.status === 'Aberto';
    
    if (wasReceived && !isUndoingWriteOff) {
      // Check if core fields are modified
      const coreFields = ['descricao', 'valor', 'categoria', 'data_documento', 'data_vencimento', 'numero_documento', 'cliente', 'observacoes'];
      const hasCoreChanges = coreFields.some(field => {
        if (req.body[field] !== undefined) {
          const original = receita[field] === null ? '' : String(receita[field]);
          const incoming = req.body[field] === null ? '' : String(req.body[field]);
          return original !== incoming;
        }
        return false;
      });
      
      if (hasCoreChanges) {
        return res.status(400).json({ detail: 'Não é possível editar os dados de uma receita já recebida. Desmarque como recebida primeiro.' });
      }
    }
    
    if (req.body.valor !== undefined) {
      const valorStr = String(req.body.valor).replace(",", ".");
      req.body.valor = parseFloat(valorStr) || 0;
    }
    if (req.body.descricao !== undefined && (!req.body.descricao || !String(req.body.descricao).trim())) {
      return res.status(400).json({ detail: 'Descrição é obrigatória' });
    }

    // Write-off logs tracking
    if (req.body.recebido === true || req.body.status === 'Recebido') {
      if (!wasReceived) {
        req.body.recebido = true;
        req.body.status = 'Recebido';
        req.body.baixado_por = req.user ? req.user.name : 'Sistema';
        req.body.baixado_em = new Date();
        if (!req.body.data_recebimento) {
          req.body.data_recebimento = getTodayDateString();
        }
      }
    } else if (req.body.recebido === false || req.body.status === 'Aberto') {
      if (wasReceived) {
        req.body.recebido = false;
        req.body.status = 'Aberto';
        req.body.baixado_por = null;
        req.body.baixado_em = null;
        req.body.data_recebimento = '';
      }
    }
    
    await receita.update(req.body);
    res.json(receita);
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

const deleteReceita = async (req, res) => {
  try {
    const receita = await db.OutrasReceitas.findByPk(req.params.id);
    if (!receita) return res.status(404).json({ detail: 'Receita não encontrada' });
    
    // Restrict deletion of paid receipts
    if (receita.recebido || receita.status === 'Recebido') {
      return res.status(400).json({ detail: 'Não é possível excluir uma receita que já foi recebida. Desmarque como recebida primeiro.' });
    }
    
    await receita.update({
      deletado: 'S',
      deletado_por: req.user ? req.user.name : 'Sistema',
      deletado_em: new Date()
    });
    
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ detail: error.message });
  }
};

export {
  createReceita, deleteReceita, listReceitas, updateReceita
};

