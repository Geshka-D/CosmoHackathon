"""Author tests: covariance oracle and deterministic seeded simulation (tests only)."""
import math
import random
import unittest
from statistics import NormalDist, stdev

from backend.app.contracts import EPS
from backend.app.research_risk import cost_risk


class ResearchRiskTests(unittest.TestCase):
    def test_zero_and_correlation_extremes_covariance(self):
        costs=[254.8,294,357,245];total=sum(costs)
        for cap,expected in [(total,1),(total-EPS/2,1),(total-2*EPS,0)]:
            result=cost_risk(costs,cap,0,0,.65,.9)
            self.assertEqual(result['probability'],expected)
            self.assertEqual(result['required_reserve'],0)
        for rho in [0,.65,1]:
            value=cost_risk(costs,1180,.05,.07,rho,.9)
            variance=sum(.07**2*a*b*1.05**2*(1 if i==j else rho) for i,a in enumerate(costs) for j,b in enumerate(costs))
            self.assertAlmostEqual(value['sd']**2,variance,places=9)
        self.assertAlmostEqual(cost_risk(costs,1180,0,.05,1,.9)['sd'],total*.05)

    def test_seeded_probability_and_sd(self):
        costs=[254.8,294,357,245];sigma=.05;rho=.65;u=.02;cap=1180
        value=cost_risk(costs,cap,u,sigma,rho,.9)
        rng=random.Random(20260912)
        samples=[]
        for _ in range(60000):
            common=rng.gauss(0,1)
            samples.append(sum(c*(1+u)*(1+sigma*(math.sqrt(rho)*common+math.sqrt(1-rho)*rng.gauss(0,1))) for c in costs))
        self.assertLess(abs(stdev(samples)/value['sd']-1),.015)
        self.assertLess(abs(sum(s<=cap for s in samples)/len(samples)-value['probability']),.008)

    def test_actual_settings_three_reserve_quantities(self):
        for u,sigma,rho,q in [(.03,.07,.4,.9),(.1,.11,1,.95),(0,.01,0,.25)]:
            value=cost_risk([200,300,400,250],1180,u,sigma,rho,q)
            self.assertEqual(value['settings'],dict(u=u,sigma=sigma,rho=rho,q=q,cap=1180))
            self.assertEqual(value['existing_margin'],1180-1150*(1+u))
            self.assertEqual(value['required_reserve'],NormalDist().inv_cdf(q)*value['sd'])
            self.assertEqual(value['missing_budget'],max(value['mu']+value['required_reserve']-1180,0))
        self.assertTrue(cost_risk([1,2],4,0,.3,0,.9)['negative_cost_warning'])

    def test_invalid_and_nonfinite(self):
        for costs in [[],[0,0],[-1,2],[math.inf],[math.nan],[1e308,1e308]]:
            with self.assertRaises(ValueError):cost_risk(costs,1180,0,.05,0,.9)
        valid=dict(cap=1180,u=0,sigma=.05,rho=.65,q=.9)
        for field,values in {'cap':[-1,math.inf],'u':[-1,math.nan,1e308],
                             'sigma':[-1,math.inf,1e308],'rho':[-.1,1.1,math.nan],
                             'q':[0,1,math.nan]}.items():
            for value in values:
                with self.assertRaises(ValueError):cost_risk([254.8,294,357,245],**{**valid,field:value})

if __name__=='__main__':unittest.main()
