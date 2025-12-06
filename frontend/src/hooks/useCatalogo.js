// src/hooks/useCatalogo.js
import { useEffect, useState } from 'react';
import api from '../services/api';

function useCatalogo(categorias = []) {
  const [catalogo, setCatalogo] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchCatalogo = async () => {
      try {
        const promises = categorias.map(cat =>
          api.get(`/api/catalogo?categoria=${cat}`).then(res =>
            res.data.map(item => ({ ...item, categoria: cat }))
          )
        );
        const resultados = await Promise.all(promises);
        setCatalogo(resultados.flat());
        setCargando(false);
      } catch (err) {
        console.error('❌ Error al cargar catálogo:', err);
        setError(err);
        setCargando(false);
      }
    };

    if (categorias.length > 0) {
      fetchCatalogo();
    }
  }, [categorias]);

  return { catalogo, cargando, error };
}

export default useCatalogo;
