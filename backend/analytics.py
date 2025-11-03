import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression
from scipy import stats
from statsmodels.tsa.stattools import adfuller
from typing import Dict, List, Tuple
import logging

logger = logging.getLogger(__name__)

class AnalyticsEngine:
    @staticmethod
    def calculate_z_score(prices: np.ndarray, window: int = 20) -> float:
        """Calculate z-score for mean reversion"""
        if len(prices) < window:
            return 0.0
        
        recent_prices = prices[-window:]
        mean = np.mean(recent_prices)
        std = np.std(recent_prices)
        
        if std == 0:
            return 0.0
        
        return float((prices[-1] - mean) / std)
    
    @staticmethod
    def calculate_spread(bid: np.ndarray, ask: np.ndarray) -> float:
        """Calculate spread between bid and ask"""
        if len(bid) == 0 or len(ask) == 0:
            return 0.0
        return float(np.mean(ask) - np.mean(bid))
    
    @staticmethod
    def calculate_volatility(prices: np.ndarray, window: int = 20) -> float:
        """Calculate rolling volatility"""
        if len(prices) < window:
            return 0.0
        
        returns = np.diff(np.log(prices[-window:]))
        return float(np.std(returns) * np.sqrt(252))  # Annualized
    
    @staticmethod
    def calculate_hedge_ratio(price1: np.ndarray, price2: np.ndarray) -> float:
        """Calculate hedge ratio via OLS regression"""
        if len(price1) < 2 or len(price2) < 2:
            return 0.0
        
        try:
            X = price1.reshape(-1, 1)
            model = LinearRegression()
            model.fit(X, price2)
            return float(model.coef_[0])
        except:
            return 0.0
    
    @staticmethod
    def adf_test(prices: np.ndarray) -> dict:
        """Augmented Dickey-Fuller test for stationarity"""
        if len(prices) < 3:
            return {"statistic": 0.0, "p_value": 1.0, "critical_values": {}, "is_stationary": False}
        
        try:
            result = adfuller(prices, autolag='AIC')
            is_stationary = bool(result[1] < 0.05)
            return {
                "statistic": float(result[0]),
                "p_value": float(result[1]),
                "is_stationary": is_stationary,
                "critical_values": {
                    "1%": float(result[4].get("1%", 0)),
                    "5%": float(result[4].get("5%", 0)),
                    "10%": float(result[4].get("10%", 0))
                }
            }
        except Exception as e:
            logger.error(f"ADF test error: {e}")
            return {"statistic": 0.0, "p_value": 1.0, "is_stationary": False, "critical_values": {}}
    
    @staticmethod
    def calculate_correlation(series1: np.ndarray, series2: np.ndarray) -> float:
        """Calculate rolling correlation"""
        if len(series1) < 2 or len(series2) < 2:
            return 0.0
        
        try:
            return float(np.corrcoef(series1, series2)[0, 1])
        except:
            return 0.0
    
    @staticmethod
    def calculate_mean_reversion_signals(prices: np.ndarray, z_score: float) -> dict:
        """Generate mean reversion trading signals"""
        entry_signal = bool(z_score > 2)  # Over-extended
        exit_signal = bool(z_score < 0)   # Revert to mean
        
        return {
            "entry": entry_signal,
            "exit": exit_signal,
            "z_score": float(z_score)
        }
    
    @staticmethod
    def calculate_robust_regression(x: np.ndarray, y: np.ndarray) -> dict:
        """Calculate Theil-Sen robust regression (resistant to outliers)"""
        if len(x) < 2 or len(y) < 2:
            return {"slope": 0.0, "intercept": 0.0}
        
        try:
            from scipy.stats import theilslopes
            slope, intercept, low, high = theilslopes(y, x)
            return {
                "slope": float(slope),
                "intercept": float(intercept),
                "low_ci": float(low),
                "high_ci": float(high)
            }
        except:
            return {"slope": 0.0, "intercept": 0.0}
    
    @staticmethod
    def calculate_liquidity_score(volumes: np.ndarray, window: int = 20) -> float:
        """Calculate liquidity score (inverse of volume volatility)"""
        if len(volumes) < window:
            return 0.0
        
        recent_volumes = volumes[-window:]
        avg_volume = np.mean(recent_volumes)
        vol_of_vol = np.std(recent_volumes)
        
        if avg_volume == 0:
            return 0.0
        
        # Lower coefficient of variation = better liquidity
        return float(avg_volume / (vol_of_vol + 1e-8))
    
    @staticmethod
    def calculate_correlation_matrix(price_series: Dict[str, np.ndarray]) -> Dict[str, Dict[str, float]]:
        """Calculate correlation matrix for multiple symbols"""
        try:
            if not price_series:
                return {}
            symbols = list(price_series.keys())
            min_length = min(len(series) for series in price_series.values())
            if min_length < 2:
                return {}
            trimmed_series = [series[-min_length:] for series in price_series.values()]
            prices_array = np.array(trimmed_series)
            
            corr_matrix = np.corrcoef(prices_array)
            result = {}
            
            for i, s1 in enumerate(symbols):
                result[s1] = {}
                for j, s2 in enumerate(symbols):
                    result[s1][s2] = float(corr_matrix[i, j])
            
            return result
        except Exception as e:
            logger.error(f"Correlation matrix error: {e}")
            return {}
    
    @staticmethod
    def calculate_macd(prices: np.ndarray, fast: int = 12, slow: int = 26, signal: int = 9) -> dict:
        """Calculate MACD (Moving Average Convergence Divergence)"""
        if len(prices) < slow:
            return {"macd": 0, "signal": 0, "histogram": 0}
        
        try:
            ema_fast = pd.Series(prices).ewm(span=fast).mean().iloc[-1]
            ema_slow = pd.Series(prices).ewm(span=slow).mean().iloc[-1]
            macd_line = ema_fast - ema_slow
            
            # Signal line (9-period EMA of MACD)
            macd_series = pd.Series(prices).ewm(span=slow).mean() - pd.Series(prices).ewm(span=fast).mean()
            signal_line = macd_series.ewm(span=signal).mean().iloc[-1]
            histogram = macd_line - signal_line
            
            return {
                "macd": float(macd_line),
                "signal": float(signal_line),
                "histogram": float(histogram)
            }
        except:
            return {"macd": 0.0, "signal": 0.0, "histogram": 0.0}
